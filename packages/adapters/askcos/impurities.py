"""Typed impurity boundary and strict atom provenance, not impurity assays.

ASKCOS impurity_predictor: MIT (MIT, 2023). RXNMapper 0.4.3: MIT
(RXN4Chemistry, 2020), doi:10.1126/sciadv.abe4166. Its official PyPI wheel
bundles the USPTO ALBERT mapping model; weights are never source artifacts.
The native service reuses the original five modes with Graph2SMILES + FF.
"""

from __future__ import annotations

import math
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from rdkit import Chem, rdBase

from packages.chemistry.forward_evaluation import validate_forward_input
from packages.workspace.structure_validation import (
    MAX_SMILES_LENGTH,
    canonical_structure,
)

from .native_models import NativeModelClient, NativeModelError

MAX_RECORD_ATOMS = 80
MAX_INPUT_ATOMS = 160
MAX_CONTEXT_ATOMS = 300
MAX_FORWARD_CALLS = 48
MAX_MAPPING_CALLS = 150
REQUEST_TIMEOUT = 180
RXNMAPPER_VERSION = "0.4.3"
RXNMAPPER_WHEEL_SHA256 = (
    "27876a4286881aafd286fd6f24a6a56a4ca6ba22d68e035a0ea120106c541ba5"
)
RANKING_STRATEGY = "best_origin_log_probability_plus_log_fast_filter_then_similarity"
MODE_LABELS = {
    1: "常规正向候选",
    2: "过度反应",
    3: "二聚化",
    4: "溶剂加成",
    5: "部分反应物组合",
}
Smiles = Annotated[str, Field(strict=True, min_length=1, max_length=MAX_SMILES_LENGTH)]
Probability = Annotated[float, Field(ge=0, le=1)]
Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class ImpurityModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ImpurityInput(ImpurityModel):
    reactants: list[Smiles] = Field(min_length=1, max_length=4)
    known_product: Smiles
    reagents: list[Smiles] = Field(default_factory=list, max_length=2)
    solvents: list[Smiles] = Field(default_factory=list, max_length=2)
    count: int = Field(default=5, strict=True, ge=1, le=10)


def canonical_input(
    body: ImpurityInput, *, max_atoms=MAX_RECORD_ATOMS
) -> ImpurityInput:
    total = 0

    def structure(value):
        nonlocal total
        canonical, atoms = canonical_structure(
            value, max_atoms=min(max_atoms, MAX_RECORD_ATOMS)
        )
        mol = Chem.MolFromSmiles(canonical)
        if any(atom.GetAtomicNum() == 0 or atom.HasQuery() for atom in mol.GetAtoms()):
            raise ValueError("杂质分析不接受 R 基或查询结构。")
        if any(atom.GetAtomMapNum() for atom in mol.GetAtoms()):
            raise ValueError("请提供未映射结构；原子映射由实际 RXNMapper 执行。")
        total += atoms
        if total > MAX_INPUT_ATOMS:
            raise ValueError(f"本次输入总原子数不能超过 {MAX_INPUT_ATOMS}。")
        return canonical

    normalized = ImpurityInput(
        reactants=[structure(value) for value in body.reactants],
        known_product=structure(body.known_product),
        reagents=[structure(value) for value in body.reagents],
        solvents=[structure(value) for value in body.solvents],
        count=body.count,
    )
    validate_forward_input(".".join(normalized.reactants + normalized.reagents))
    return normalized


class FragmentRetention(ImpurityModel):
    smiles: str
    supplied_atoms: int
    retained_atoms: int
    fraction: Probability


class AtomMapping(ImpurityModel):
    mapped_reaction: str = Field(min_length=3, max_length=32768)
    confidence: Probability
    required_fragments: list[FragmentRetention] = Field(max_length=2)
    mode_consistent: bool


def _mapped_molecule(smiles):
    params = Chem.SmilesParserParams()
    params.removeHs = False
    params.parseName = False
    params.allowCXSMILES = False
    with rdBase.BlockLogs():
        mol = Chem.MolFromSmiles(smiles, params)
    if mol is None or any(
        atom.GetAtomicNum() == 0 or atom.HasQuery() for atom in mol.GetAtoms()
    ):
        raise ValueError("RXNMapper 返回无效结构。")
    return mol


def _without_maps(molecule):
    mol = Chem.Mol(molecule)
    for atom in mol.GetAtoms():
        atom.SetAtomMapNum(0)
    return canonical_structure(
        Chem.MolToSmiles(mol, isomericSmiles=True), max_atoms=MAX_CONTEXT_ATOMS
    )[0]


def validate_mapping(
    reactants, product, mapped, confidence, required=()
) -> AtomMapping:
    """Validate actual RXNMapper output; unmatched required fragments never pass.

    Keep the original mode test (>30% retained atoms), not a new reaction rule.
    Salts are matched as full declared records using a multiset of components.
    Spectator reactant atoms may be unmapped; every product atom must have an
    element/isotope-consistent positive source mapping, with no duplicate IDs.
    """
    if (
        not isinstance(mapped, str)
        or mapped.count(">>") != 1
        or not math.isfinite(confidence)
        or not 0 <= confidence <= 1
    ):
        raise ValueError("RXNMapper 返回无效映射或置信值。")
    left, right = mapped.split(">>")
    rmol, pmol = _mapped_molecule(left), _mapped_molecule(right)
    if _without_maps(rmol) != reactants or _without_maps(pmol) != product:
        raise ValueError("原子映射改变了结构、盐组分、同位素或立体化学。")
    source = {}
    for atom in rmol.GetAtoms():
        number = atom.GetAtomMapNum()
        if number:
            if number in source:
                raise ValueError("反应物映射标识重复。")
            source[number] = (atom.GetAtomicNum(), atom.GetIsotope())
    used = set()
    for atom in pmol.GetAtoms():
        number = atom.GetAtomMapNum()
        if (
            not number
            or number in used
            or source.get(number) != (atom.GetAtomicNum(), atom.GetIsotope())
        ):
            raise ValueError("产物原子缺少唯一、元素与同位素一致的来源映射。")
        used.add(number)
    available = list(Chem.GetMolFrags(rmol, asMols=True))
    retentions = []
    matched = True
    for value in required:
        selected = []
        for target in Chem.GetMolFrags(_mapped_molecule(value), asMols=True):
            canonical = _without_maps(target)
            index = next(
                (
                    i
                    for i, fragment in enumerate(available)
                    if _without_maps(fragment) == canonical
                ),
                None,
            )
            if index is None:
                matched = False
                break
            selected.append(available.pop(index))
        atoms = sum(fragment.GetNumAtoms() for fragment in selected)
        retained = sum(
            atom.GetAtomMapNum() in used
            for fragment in selected
            for atom in fragment.GetAtoms()
        )
        expected = _mapped_molecule(value).GetNumAtoms()
        fraction = retained / expected if expected else 0
        retentions.append(
            FragmentRetention(
                smiles=value,
                supplied_atoms=expected,
                retained_atoms=retained,
                fraction=fraction,
            )
        )
        matched = matched and atoms == expected and fraction > 0.3
    return AtomMapping(
        mapped_reaction=mapped,
        confidence=confidence,
        required_fragments=retentions,
        mode_consistent=matched,
    )


class ImpurityOrigin(ImpurityModel):
    mode: int = Field(ge=1, le=5)
    mode_label: str
    reactants: str
    log_probability: float = Field(le=0)
    feasibility_score: Probability
    mapping_confidence: Probability
    required_fragments: list[FragmentRetention] = Field(max_length=2)
    mapping: AtomMapping


def origin_ranking_score(origin: ImpurityOrigin) -> float:
    """Joint model-score heuristic, not a calibrated success probability."""
    return origin.log_probability + math.log(max(origin.feasibility_score, 1e-30))


class ImpurityCandidate(ImpurityModel):
    product: str
    molecular_weight_g_mol: float
    similarity_to_known_product: Probability
    mapping: AtomMapping
    origins: list[ImpurityOrigin] = Field(min_length=1, max_length=MAX_FORWARD_CALLS)


class KnownMajorProduct(ImpurityModel):
    smiles: str
    evidence_type: Literal["user_supplied_reference"] = "user_supplied_reference"


class ImpurityProvenance(ImpurityModel):
    algorithm: Literal["askcos_five_mode_impurity_predictor"] = (
        "askcos_five_mode_impurity_predictor"
    )
    algorithm_source_sha256: Hash
    integration_source_sha256: Hash
    forward_model: Literal["graph2smiles_uspto_stereo"]
    forward_asset_identity: Hash
    fast_filter_model: Literal["askcos_fast_filter"]
    mapper_model: Literal["rxnmapper_albert_uspto_all_1310k"]
    mapper_asset_identity: Hash
    mapper_package_version: Literal["0.4.3"]
    mapper_wheel_sha256: Hash
    mapper_license: Literal["MIT"]
    mapper_reference_url: str
    versions: dict[str, str]
    ranking_strategy: Literal[
        "best_origin_log_probability_plus_log_fast_filter_then_similarity"
    ]


class SkippedContext(ImpurityModel):
    mode: int = Field(ge=2, le=5)
    reactants: str
    reason: Literal["atom_only_context_not_supported"]


class ImpurityExecution(ImpurityModel):
    forward_calls: int = Field(ge=1, le=MAX_FORWARD_CALLS)
    mapping_calls: int = Field(ge=0, le=MAX_MAPPING_CALLS)
    mapping_rejected: int = Field(ge=0)
    candidate_count_before_limit: int = Field(ge=0, le=150)
    modes_completed: list[int]
    elapsed_seconds: float = Field(ge=0, le=REQUEST_TIMEOUT + 5)
    skipped_atom_only_contexts: list[SkippedContext] = Field(
        default_factory=list, max_length=48
    )


class ImpurityResult(ImpurityModel):
    scope: Literal["possible_impurity_model_predictions"] = (
        "possible_impurity_model_predictions"
    )
    record_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    inputs: ImpurityInput
    known_major_product: KnownMajorProduct
    candidates: list[ImpurityCandidate] = Field(max_length=10)
    provenance: ImpurityProvenance
    execution: ImpurityExecution
    notices: list[str]

    @model_validator(mode="after")
    def bound_predictions_to_reference(self):
        if (
            self.known_major_product.smiles != self.inputs.known_product
            or len(self.candidates) > self.inputs.count
        ):
            raise ValueError("杂质结果没有绑定本次输入。")
        products = [row.product for row in self.candidates]
        if len(products) != len(set(products)) or self.inputs.known_product in products:
            raise ValueError("已知主产物不能冒充预测杂质或重复候选。")
        if self.execution.modes_completed != [1, 2, 3, 4, 5]:
            raise ValueError("杂质模式执行未完成。")
        for row in self.candidates:
            if row.mapping != row.origins[0].mapping:
                raise ValueError("候选完整映射必须绑定当前最佳来源。")
            origin_scores = [origin_ranking_score(origin) for origin in row.origins]
            if origin_scores != sorted(origin_scores, reverse=True):
                raise ValueError("杂质来源没有按声明的联合评分启发式排序。")
            for origin in row.origins:
                if origin.mode_label != MODE_LABELS[origin.mode] or (
                    origin.mode in {2, 3, 4} and not origin.required_fragments
                ):
                    raise ValueError("杂质模式缺少实际来源映射证据。")
                if (
                    not origin.mapping.mode_consistent
                    or origin.mapping.confidence != origin.mapping_confidence
                    or origin.mapping.required_fragments != origin.required_fragments
                ):
                    raise ValueError("杂质来源映射与来源评分或保留证据不一致。")
        ranks = [
            (origin_ranking_score(row.origins[0]), row.similarity_to_known_product)
            for row in self.candidates
        ]
        if ranks != sorted(ranks, reverse=True):
            raise ValueError("杂质候选没有按声明的联合评分启发式排序。")
        return self


class ImpurityAdapter:
    def __init__(self, base_url="http://127.0.0.1:9941"):
        self.client = NativeModelClient(base_url, timeout=REQUEST_TIMEOUT + 10)

    def predict(self, body: ImpurityInput) -> ImpurityResult:
        try:
            result = ImpurityResult.model_validate(
                self.client.post("/predict", body.model_dump(mode="json"))
            )
            if result.inputs != body:
                raise ValueError("Impurity response is not bound to this input")
            for row in result.candidates:
                if (
                    canonical_structure(row.product, max_atoms=MAX_CONTEXT_ATOMS)[0]
                    != row.product
                    or not row.mapping.mode_consistent
                ):
                    raise ValueError("Invalid impurity structure or mapping")
            return result
        except ValueError as exc:
            raise NativeModelError("杂质服务返回无效结构、映射或来源信息。") from exc
