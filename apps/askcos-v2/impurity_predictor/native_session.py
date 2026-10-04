"""One bounded execution of the original ASKCOS five impurity modes."""

import io
import time
from contextlib import redirect_stderr, redirect_stdout

from rdkit import Chem, DataStructs
from rdkit.Chem import Descriptors

from packages.adapters.askcos.impurities import (
    MAX_CONTEXT_ATOMS,
    MAX_FORWARD_CALLS,
    MAX_MAPPING_CALLS,
    MODE_LABELS,
    REQUEST_TIMEOUT,
    ImpurityCandidate,
    ImpurityExecution,
    ImpurityOrigin,
    ImpurityResult,
    KnownMajorProduct,
    origin_ranking_score,
    validate_mapping,
)
from packages.adapters.askcos.native_models import NativeModelError
from packages.chemistry.forward_evaluation import validate_forward_input
from packages.workspace.structure_validation import canonical_structure


class PredictionSession:
    """Per-request bounded caches, model evidence and a single execution deadline."""

    def __init__(self, mapper, forward, provenance):
        self.mapper, self.forward, self.provenance = mapper, forward, provenance
        self.started = time.monotonic()
        self.deadline = self.started + REQUEST_TIMEOUT
        self.predictions, self.mappings, self.rows, self.mode_checks = {}, {}, {}, {}
        self.skipped = {}
        self.mode = 1
        self.rejected = 0

    def check_deadline(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise NativeModelError("杂质分析超过总时限。", 504)
        return remaining

    def predict(self, *, smiles, backend, model_name):
        self.check_deadline()
        if (
            len(smiles) != 1
            or backend != "graph2smiles"
            or model_name != "uspto_stereo"
        ):
            raise ValueError("Unsupported impurity forward configuration.")
        canonical = canonical_structure(smiles[0], max_atoms=MAX_CONTEXT_ATOMS)[0]
        try:
            validate_forward_input(canonical)
        except ValueError:
            molecule = Chem.MolFromSmiles(canonical)
            if (
                self.mode != 1
                and molecule.GetNumBonds() == 0
                and all(
                    atom.GetAtomicNum() > 0 and not atom.HasQuery()
                    for atom in molecule.GetAtoms()
                )
            ):
                self.skipped[self.mode, canonical] = {
                    "mode": self.mode,
                    "reactants": canonical,
                    "reason": "atom_only_context_not_supported",
                }
                return [[]]
            raise
        if canonical not in self.predictions:
            if len(self.predictions) >= MAX_FORWARD_CALLS:
                raise ValueError("Impurity forward call budget exhausted.")
            self.forward.model.timeout = min(30, self.check_deadline())
            self.forward.filter.timeout = min(30, self.check_deadline())
            prediction = self.forward.predict(reactants=canonical, count=3)
            if prediction.asset_identity != self.provenance.forward_asset_identity:
                raise ValueError(
                    "Forward model assets changed during impurity analysis."
                )
            self.predictions[canonical] = prediction.products
            for row in prediction.products:
                self.rows[canonical, row.product] = row
        return [
            [
                {
                    "outcome": row.product,
                    "score": row.log_probability,
                    "prob": row.feasibility_score,
                }
                for row in self.predictions[canonical]
            ]
        ]

    def inspect(self, *, reactant_smiles, target):
        canonical = canonical_structure(reactant_smiles, max_atoms=MAX_CONTEXT_ATOMS)[0]
        return {"prob": self.rows[canonical, target].feasibility_score}

    def map(self, reactants, product, required=()):
        self.check_deadline()
        reactants = canonical_structure(reactants, max_atoms=MAX_CONTEXT_ATOMS)[0]
        key = reactants, product
        if key not in self.mappings:
            if len(self.mappings) >= MAX_MAPPING_CALLS:
                raise ValueError("Impurity mapping budget exhausted.")
            reaction = reactants + ">>" + product
            if (
                len(self.mapper.tokenize_for_model(reaction))
                > self.mapper.model.config.max_position_embeddings
            ):
                raise ValueError("候选反应超过实际 RXNMapper 的 512 token 支持范围。")
            row = self.mapper.get_attention_guided_atom_maps([reaction])[0]
            self.mappings[key] = validate_mapping(
                reactants, product, row["mapped_rxn"], row["confidence"]
            )
        basic = self.mappings[key]
        evidence = validate_mapping(
            reactants, product, basic.mapped_reaction, basic.confidence, required
        )
        if required:
            self.mode_checks[reactants, product, self.mode] = evidence
        return evidence


def predict_impurities(body, models):
    mapper, forward, legacy_class, provenance = models
    session = PredictionSession(mapper, forward, provenance)

    class IntegratedPredictor(legacy_class):
        def check_mode_outcome(self, rsmi, psmi, sub_rct_to_check):
            if self.check_mapping is not True:
                raise ValueError("Impurity mode checks require actual atom mapping.")
            matched = session.map(rsmi, psmi, sub_rct_to_check).mode_consistent
            session.rejected += int(not matched)
            return matched

    predictor = IntegratedPredictor(
        "graph2smiles",
        "uspto_stereo",
        "askcos_fast_filter",
        "rxnmapper",
        check_mapping=True,
    )
    predictor.predictor, predictor.inspector, predictor.mapper = (
        session.predict,
        session.inspect,
        mapper,
    )
    rct, sol = body.reactants, body.solvents
    rea = [".".join(body.reagents)] if body.reagents else []
    full = predictor.merge_smiles(rct + rea)
    normal = session.predict(
        smiles=[full], backend="graph2smiles", model_name="uspto_stereo"
    )[0]
    with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        # Preserve complete chemical records rather than legacy predict() dot splitting.
        outcomes = predictor.predict_M1(rct, rea, [body.known_product], sol)
        for mode in [2, 3, 4, 5]:
            session.mode = mode
            outcomes.extend(
                getattr(predictor, f"predict_M{mode}")(rct, rea, sol, outcomes)
            )
    grouped = {}
    records = [(full, row["outcome"], 1, ()) for row in normal]
    for row in outcomes:
        if (
            row["mode"] == 1
        ):  # The legacy supplied-product insp_score=1 is not model evidence.
            continue
        context = predictor.merge_smiles([row["rct_smiles"]] + row["rea_smiles"])
        records.append((context, row["prd_smiles"], row["mode"], ()))
    reference = Chem.RDKFingerprint(Chem.MolFromSmiles(body.known_product))
    for context, product, mode, required in records:
        if product == body.known_product:
            continue
        canonical = canonical_structure(context, max_atoms=MAX_CONTEXT_ATOMS)[0]
        evidence = session.map(canonical, product, required)
        row = session.rows[canonical, product]
        requirement = session.mode_checks.get((canonical, product, mode), evidence)
        origin = ImpurityOrigin(
            mode=mode,
            mode_label=MODE_LABELS[mode],
            reactants=canonical,
            log_probability=row.log_probability,
            feasibility_score=row.feasibility_score,
            mapping_confidence=requirement.confidence,
            required_fragments=requirement.required_fragments,
            mapping=requirement,
        )
        if product not in grouped:
            grouped[product] = ImpurityCandidate(
                product=product,
                molecular_weight_g_mol=Descriptors.MolWt(Chem.MolFromSmiles(product)),
                similarity_to_known_product=DataStructs.FingerprintSimilarity(
                    reference, Chem.RDKFingerprint(Chem.MolFromSmiles(product))
                ),
                mapping=requirement,
                origins=[origin],
            )
        else:
            grouped[product].origins.append(origin)
    for row in grouped.values():
        row.origins.sort(key=origin_ranking_score, reverse=True)
        row.mapping = row.origins[0].mapping
    candidates = sorted(
        grouped.values(),
        key=lambda row: (
            origin_ranking_score(row.origins[0]),
            row.similarity_to_known_product,
        ),
        reverse=True,
    )
    notices = [
        "结果为可能杂质的模型候选，不是检测结果、杂质含量或实验成功率。",
        "已知主产物为用户输入基准，未将原生 insp_score=1 当作预测或实验评分。",
        "五模式复用 ASKCOS；单个组合最多取 3 个正向候选，FF 阈值沿用 0.2（首候选保留）。",
        "过度反应、二聚化与溶剂加成沿用 >30% 原子保留判据；未匹配片段不放行。",
        "按最佳来源的序列对数评分 + ln(max(FF, 1e-30)) 启发式排序；结构相似度仅作同分次排序。",
        "联合评分不是经校准的成功率、风险、浓度或检出概率。",
        "FF 对重复单体的指纹区分有限；该边界不被映射检查或相似度消除。",
        "FF 服务当前不返回模型文件哈希；记录实际服务模型名称，不编造资产标识。",
    ]
    result = ImpurityResult(
        inputs=body,
        known_major_product=KnownMajorProduct(smiles=body.known_product),
        candidates=candidates[: body.count],
        provenance=provenance,
        execution=ImpurityExecution(
            forward_calls=len(session.predictions),
            mapping_calls=len(session.mappings),
            mapping_rejected=session.rejected,
            candidate_count_before_limit=len(candidates),
            modes_completed=[1, 2, 3, 4, 5],
            elapsed_seconds=time.monotonic() - session.started,
            skipped_atom_only_contexts=list(session.skipped.values()),
        ),
        notices=notices,
    )
    return result.model_dump(mode="json")
