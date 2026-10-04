"""Molecular descriptors, not reaction or route validation.

SA: Ertl/Schuffenhauer (2009), doi:10.1186/1758-2946-1-8; the maintained
rdkit.Contrib.SA_Score implementation (Novartis, BSD-3-Clause) includes its
documented macrocycle/symmetry modifications. SPS/nSPS: Krzyzanowski et al.
(2023), doi:10.1021/acs.jmedchem.3c00689. Bertz: Bertz (1981),
doi:10.1021/ja00402a071. SPS, Bertz and descriptors use RDKit's BSD-3-Clause
implementations. No algorithm, fragment table or third-party code is vendored.
"""

from __future__ import annotations

import math
import pickle
from threading import Lock
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from rdkit import Chem, rdBase
from rdkit.Chem import Crippen, Descriptors, GraphDescriptors, Lipinski, SpacialScore
from rdkit.Chem import rdMolDescriptors

from packages.workspace.structure_validation import canonical_structure

MAX_ASSESSMENT_ATOMS = 256  # Bertz uses a distance matrix; bound this synchronous work.
_SA_LOCK = Lock()


class AssessmentUnavailable(RuntimeError):
    """An installed RDKit calculation dependency is unavailable or damaged."""


class ChemistryModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class StructureIdentity(ChemistryModel):
    smiles: str
    formula: str
    molecular_weight_g_mol: float
    exact_mass_da: float
    formal_charge: int
    atoms: int
    heavy_atoms: int
    components: int


class MoleculeDescriptors(ChemistryModel):
    h_bond_donors: int
    h_bond_acceptors: int
    tpsa_angstrom2: float
    logp_crippen: float
    rotatable_bonds: int
    rings: int
    aromatic_rings: int
    fraction_csp3: float
    potential_stereocenters: int
    unassigned_stereocenters: int


class ComplexityMetrics(ChemistryModel):
    sa_score: float | None
    sps: float
    nsps: float | None
    bertz_ct: float


class ComponentAssessment(ChemistryModel):
    index: int
    structure: StructureIdentity
    metrics: ComplexityMetrics
    notices: list[str]


class MethodSource(ChemistryModel):
    name: str
    implementation: str
    reference_url: str
    source_url: str
    license: str


METHODS = (
    MethodSource(
        name="SA Score (Ertl / Schuffenhauer)",
        implementation="rdkit.Contrib.SA_Score.sascorer.calculateScore",
        reference_url="https://doi.org/10.1186/1758-2946-1-8",
        source_url="https://github.com/rdkit/rdkit/blob/master/Contrib/SA_Score/sascorer.py",
        license="BSD-3-Clause; Copyright 2013 Novartis Institutes for BioMedical Research",
    ),
    MethodSource(
        name="SPS / nSPS (Krzyzanowski et al.)",
        implementation="rdkit.Chem.SpacialScore.SPS",
        reference_url="https://doi.org/10.1021/acs.jmedchem.3c00689",
        source_url="https://github.com/rdkit/rdkit/blob/master/rdkit/Chem/SpacialScore.py",
        license="BSD-3-Clause; Copyright 2023 RDKit Hackathon contributors",
    ),
    MethodSource(
        name="Bertz CT",
        implementation="rdkit.Chem.GraphDescriptors.BertzCT (cutoff=100)",
        reference_url="https://doi.org/10.1021/ja00402a071",
        source_url="https://github.com/rdkit/rdkit/blob/master/rdkit/Chem/GraphDescriptors.py",
        license="BSD-3-Clause; RDKit contributors",
    ),
    MethodSource(
        name="RDKit molecular descriptors",
        implementation="rdkit.Chem.Descriptors / Lipinski / Crippen / rdMolDescriptors",
        reference_url="https://rdkit.org/docs/source/rdkit.Chem.Descriptors.html",
        source_url="https://github.com/rdkit/rdkit/blob/master/license.txt",
        license="BSD-3-Clause; RDKit contributors",
    ),
)


class MolecularAssessment(ChemistryModel):
    scope: Literal["molecular_descriptors_only"] = "molecular_descriptors_only"
    record_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    rdkit_version: str
    structure: StructureIdentity
    descriptors: MoleculeDescriptors
    components: list[ComponentAssessment]
    notices: list[str]
    methods: list[MethodSource]


def parse_molecule(smiles: str, *, max_atoms: int | None = None):
    """Use the workspace identity boundary, without desalting or neutralization."""
    try:
        canonical, _ = canonical_structure(smiles, max_atoms=max_atoms)
    except ValueError as exc:
        raise ValueError("无法解析结构，或结构超过长度 / 原子数限制。") from exc
    parameters = Chem.SmilesParserParams()
    parameters.removeHs = False
    parameters.parseName = False
    parameters.allowCXSMILES = False
    with rdBase.BlockLogs():
        molecule = Chem.MolFromSmiles(canonical, parameters)
    if molecule is None or any(
        atom.GetAtomicNum() == 0 or atom.HasQuery() for atom in molecule.GetAtoms()
    ):
        raise ValueError("核算需要确定的化学结构，不接受 R 基或查询原子。")
    return canonical, molecule


def describe_identity(canonical: str, molecule) -> StructureIdentity:
    return StructureIdentity(
        smiles=canonical,
        formula=rdMolDescriptors.CalcMolFormula(molecule),
        molecular_weight_g_mol=Descriptors.MolWt(molecule),
        exact_mass_da=rdMolDescriptors.CalcExactMolWt(molecule),
        formal_charge=Chem.GetFormalCharge(molecule),
        atoms=molecule.GetNumAtoms(),
        heavy_atoms=molecule.GetNumHeavyAtoms(),
        components=len(Chem.GetMolFrags(molecule)),
    )


def _sa_score(molecule) -> float:
    try:
        from rdkit.Contrib.SA_Score import sascorer

        # The upstream table is lazy global state. Initialize once under a lock.
        with _SA_LOCK:
            if sascorer._fscores is None:
                sascorer.readFragmentScores()
        score = sascorer.calculateScore(molecule)
    except (ImportError, OSError, EOFError, pickle.UnpicklingError, ValueError, RuntimeError) as exc:
        raise AssessmentUnavailable("官方 RDKit SA_Score 或片段数据不可用。") from exc
    if score is None or not math.isfinite(score):
        raise AssessmentUnavailable("RDKit SA_Score 未返回有限数值。")
    return score


def assess_molecule(smiles: str, *, max_atoms: int = MAX_ASSESSMENT_ATOMS):
    limit = min(max_atoms, MAX_ASSESSMENT_ATOMS)
    canonical, molecule = parse_molecule(smiles, max_atoms=limit)
    structure = describe_identity(canonical, molecule)
    centers = Chem.FindMolChiralCenters(
        molecule, includeUnassigned=True, useLegacyImplementation=False
    )
    descriptors = MoleculeDescriptors(
        h_bond_donors=Lipinski.NumHDonors(molecule),
        h_bond_acceptors=Lipinski.NumHAcceptors(molecule),
        tpsa_angstrom2=rdMolDescriptors.CalcTPSA(molecule),
        logp_crippen=Crippen.MolLogP(molecule),
        rotatable_bonds=Lipinski.NumRotatableBonds(molecule),
        rings=rdMolDescriptors.CalcNumRings(molecule),
        aromatic_rings=rdMolDescriptors.CalcNumAromaticRings(molecule),
        fraction_csp3=rdMolDescriptors.CalcFractionCSP3(molecule),
        potential_stereocenters=len(centers),
        unassigned_stereocenters=sum(label == "?" for _, label in centers),
    )
    components = []
    for index, fragment in enumerate(Chem.GetMolFrags(molecule, asMols=True), 1):
        fragment_smiles = Chem.MolToSmiles(fragment, isomericSmiles=True)
        heavy_atoms = fragment.GetNumHeavyAtoms()
        organic = any(atom.GetAtomicNum() == 6 for atom in fragment.GetAtoms())
        notices = []
        if not organic:
            notices.append("非含碳组分：不提供药物样分子的 SA Score。")
        if not heavy_atoms:
            notices.append("无重原子：nSPS 未定义。")
        components.append(ComponentAssessment(
            index=index,
            structure=describe_identity(fragment_smiles, fragment),
            metrics=ComplexityMetrics(
                sa_score=_sa_score(fragment) if organic else None,
                sps=SpacialScore.SPS(fragment, normalize=False),
                nsps=SpacialScore.SPS(fragment, normalize=True) if heavy_atoms else None,
                bertz_ct=GraphDescriptors.BertzCT(fragment, cutoff=100),
            ),
            notices=notices,
        ))
    notices = [
        "分子描述符与经验复杂度指标，不是完整路线验证或实验可合成性证明。",
        "SA Score 采用 RDKit 对原方法的宏环与对称性修订；1 较易、10 较难。",
        "SPS 为拓扑空间复杂度，nSPS 按重原子数归一化；不是三维构象计算。",
        "Crippen logP 为计算描述符，不是实测溶解度。",
    ]
    if structure.components > 1:
        notices.append("保留全部盐 / 离子组分；复杂度按组分计算，不合并成整条记录的评分。")
    if descriptors.unassigned_stereocenters:
        notices.append("存在未指定的立体中心；未替用户指定构型。")
    return MolecularAssessment(
        rdkit_version=rdBase.rdkitVersion,
        structure=structure,
        descriptors=descriptors,
        components=components,
        notices=notices,
        methods=list(METHODS),
    )
