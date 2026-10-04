"""User-entered batch mass accounting; no scale-up or yield prediction.

PMI = total mass of inputs (including water) / isolated bulk product mass.
ACS GCI Pharmaceutical Roundtable definition:
https://www.acs.org/green-chemistry-sustainability/green-chemistry-nexus/articles/process-mass-intensity-calculation-tool.html
Recovered outputs are not subtracted from gross input PMI. The mass difference
is not measured waste or an E-factor. Stoichiometry is declared by the user,
not inferred or independently validated from molecular structures.
"""

from __future__ import annotations

from math import fsum, isclose
from typing import Annotated, Literal

from pydantic import Field, model_validator
from rdkit import rdBase

from .assessment import ChemistryModel, StructureIdentity, describe_identity, parse_molecule
from packages.workspace.structure_validation import MAX_SMILES_LENGTH

MAX_MATERIALS = 50
MAX_PROCESS_ATOMS = 4096
MassUnit = Literal["mg", "g", "kg"]
InputRole = Literal["reactant", "reagent", "catalyst", "solvent", "water", "auxiliary"]
OutputRole = Literal["waste", "recovered", "coproduct"]
Nonnegative = Annotated[float, Field(strict=True, ge=0, le=1e9)]
Percent = Annotated[float, Field(strict=True, ge=0, le=100)]
Coefficient = Annotated[float, Field(strict=True, gt=0, le=1e6)]
Smiles = Annotated[str, Field(strict=True, min_length=1, max_length=MAX_SMILES_LENGTH)]
MaterialId = Annotated[str, Field(strict=True, pattern=r"^[A-Za-z0-9_-]{1,64}$")]
UNIT_TO_GRAMS = {"mg": 0.001, "g": 1.0, "kg": 1000.0}
ROLE_LABELS = {
    "reactant": "反应物", "reagent": "试剂", "catalyst": "催化剂",
    "solvent": "溶剂", "water": "水", "auxiliary": "辅助物料",
    "waste": "实测废物", "recovered": "回收物", "coproduct": "副产物",
}


class MassQuantity(ChemistryModel):
    value: Nonnegative | None = None
    unit: MassUnit

    def grams(self) -> float | None:
        return None if self.value is None else self.value * UNIT_TO_GRAMS[self.unit]


class MaterialInput(ChemistryModel):
    id: MaterialId
    name: str = Field(default="", max_length=160, strict=True)
    smiles: Smiles | None = None
    role: InputRole
    mass: MassQuantity


class OtherOutputInput(ChemistryModel):
    id: MaterialId
    name: str = Field(default="", max_length=160, strict=True)
    smiles: Smiles | None = None
    role: OutputRole
    mass: MassQuantity


class ProductInput(ChemistryModel):
    smiles: Smiles
    mass: MassQuantity
    purity_mass_percent: Percent | None = None
    reported_yield_percent: Percent | None = None


class YieldBasis(ChemistryModel):
    limiting_material_id: MaterialId
    limiting_purity_mass_percent: Percent
    reactant_coefficient: Coefficient
    product_coefficient: Coefficient


class ProcessInput(ChemistryModel):
    materials: list[MaterialInput] = Field(min_length=1, max_length=MAX_MATERIALS)
    product: ProductInput
    other_outputs: list[OtherOutputInput] = Field(default_factory=list, max_length=MAX_MATERIALS)
    input_boundary_complete: bool = Field(default=False, strict=True)
    yield_basis: YieldBasis | None = None

    @model_validator(mode="after")
    def unique_material_ids(self):
        ids = [row.id for row in [*self.materials, *self.other_outputs]]
        if len(ids) != len(set(ids)):
            raise ValueError("物料标识不能重复。")
        if self.yield_basis and self.yield_basis.limiting_material_id not in {
            row.id for row in self.materials if row.role == "reactant"
        }:
            raise ValueError("收率依据必须指定表内的一条反应物。")
        return self


class MaterialResult(ChemistryModel):
    id: str
    name: str
    role: str
    role_label: str
    structure: StructureIdentity | None
    mass: MassQuantity
    mass_g: float | None


class ProductResult(ChemistryModel):
    structure: StructureIdentity
    mass: MassQuantity
    isolated_mass_g: float | None
    purity_mass_percent: float | None
    pure_mass_g: float | None
    reported_yield_percent: float | None
    theoretical_mass_g: float | None
    calculated_yield_percent: float | None


class ProcessMetrics(ChemistryModel):
    known_input_mass_g: float
    total_input_mass_g: float | None
    known_other_output_mass_g: float
    non_product_mass_difference_g: float | None
    unaccounted_mass_g: float | None
    recorded_mass_recovery_percent: float | None
    pmi: float | None
    pmi_lower_bound: float | None
    purity_corrected_pmi: float | None
    pmi_status: Literal["calculated", "lower_bound", "unavailable"]


class ProcessResult(ChemistryModel):
    scope: Literal["user_entered_batch_accounting"] = "user_entered_batch_accounting"
    record_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    rdkit_version: str
    input_boundary_complete: bool
    materials: list[MaterialResult]
    other_outputs: list[MaterialResult]
    product: ProductResult
    yield_basis: YieldBasis | None
    metrics: ProcessMetrics
    missing_inputs: list[str]
    notices: list[str]
    pmi_reference_url: str


def calculate_process(body: ProcessInput, *, max_atoms: int | None = None) -> ProcessResult:
    missing, notices = [], []
    atom_count = 0

    def identity(smiles):
        nonlocal atom_count
        if smiles is None:
            return None
        canonical, molecule = parse_molecule(smiles, max_atoms=max_atoms)
        atom_count += molecule.GetNumAtoms()
        if atom_count > MAX_PROCESS_ATOMS:
            raise ValueError(f"本次核算的总结构原子数不能超过 {MAX_PROCESS_ATOMS}。")
        return describe_identity(canonical, molecule)

    def material(row, index):
        if row.mass.value is None:
            missing.append(f"{ROLE_LABELS[row.role]} {index}：缺少质量。")
        if row.smiles is None:
            notices.append(f"{ROLE_LABELS[row.role]} {index}：未提供结构，不推断化学身份或分子量。")
        return MaterialResult(
            id=row.id, name=row.name, role=row.role, role_label=ROLE_LABELS[row.role],
            structure=identity(row.smiles), mass=row.mass, mass_g=row.mass.grams(),
        )

    materials = [material(row, index) for index, row in enumerate(body.materials, 1)]
    outputs = [material(row, index) for index, row in enumerate(body.other_outputs, 1)]
    product_identity = identity(body.product.smiles)
    gross = body.product.mass.grams()
    purity = body.product.purity_mass_percent
    pure = None if gross is None or purity is None else gross * (purity / 100)
    known_inputs = fsum(row.mass_g for row in materials if row.mass_g is not None)
    known_outputs = fsum(row.mass_g for row in outputs if row.mass_g is not None)
    complete = body.input_boundary_complete and all(row.mass_g is not None for row in materials)
    total = known_inputs if complete else None
    if not body.input_boundary_complete:
        missing.append("尚未确认投料边界完整（含试剂、溶剂、水与后处理物料）。")
    if gross is None:
        missing.append("产物：缺少分离总质量。")
    elif gross == 0:
        notices.append("分离产物质量为零：PMI 分母为零，不返回无穷大或零 PMI。")
    if purity is None:
        missing.append("产物：缺少质量纯度，纯产物质量与纯度校正指标未定义。")
    elif purity == 0:
        notices.append("产物质量纯度为零：纯度校正 PMI 未定义。")
    if known_inputs == 0:
        notices.append("已录入投料质量为零；不视为无物料消耗的工艺。")

    difference = None if total is None or gross is None else total - gross
    if difference is not None and difference < 0 and not isclose(total, gross, rel_tol=1e-12, abs_tol=0):
        raise ValueError("完整投料边界下，分离产物质量超过总投料；请核对质量、单位和边界。")
    residual = None
    recovery = None
    if difference is not None and all(row.mass_g is not None for row in outputs):
        residual = difference - known_outputs
        if residual < 0 and not isclose(total, gross + known_outputs, rel_tol=1e-12, abs_tol=0):
            raise ValueError("完整投料边界下，已记录产物与其他出料质量超过总投料；请核对质量、单位和边界。")
        if total > 0:
            recovery = (gross + known_outputs) / total * 100

    denominator_valid = gross is not None and gross > 0
    pmi = total / gross if total is not None and denominator_valid else None
    lower = known_inputs / gross if total is None and denominator_valid else None
    corrected = total / pure if total is not None and pure is not None and pure > 0 else None
    theoretical, calculated_yield = _calculate_yield(body, materials, product_identity, pure, missing, notices)
    if calculated_yield is not None and calculated_yield > 100 + 1e-9:
        notices.append("计算收率超过 100%：请核对限量原料、计量系数、质量纯度及单位；不是放大预测。")
    notices.extend([
        "仅核算用户录入批次；不验证反应计量、完整路线或预测工艺放大。",
        "PMI 使用分离产物总质量；纯度校正 PMI 单列，质量纯度不是 HPLC 面积纯度。",
        "回收物不从总投料 PMI 自动扣除；输入减产物的差额不是实测废物或 E-factor。",
        "分子量按完整结构记录计算，保留盐、同位素与立体化学；不自动换成游离形式。",
    ])
    return ProcessResult(
        rdkit_version=rdBase.rdkitVersion, input_boundary_complete=body.input_boundary_complete,
        materials=materials, other_outputs=outputs, yield_basis=body.yield_basis,
        product=ProductResult(
            structure=product_identity, mass=body.product.mass, isolated_mass_g=gross,
            purity_mass_percent=purity, pure_mass_g=pure,
            reported_yield_percent=body.product.reported_yield_percent,
            theoretical_mass_g=theoretical, calculated_yield_percent=calculated_yield,
        ),
        metrics=ProcessMetrics(
            known_input_mass_g=known_inputs, total_input_mass_g=total,
            known_other_output_mass_g=known_outputs,
            non_product_mass_difference_g=difference, unaccounted_mass_g=residual,
            recorded_mass_recovery_percent=recovery, pmi=pmi, pmi_lower_bound=lower,
            purity_corrected_pmi=corrected,
            pmi_status="calculated" if pmi is not None else "lower_bound" if lower is not None else "unavailable",
        ),
        missing_inputs=missing, notices=notices,
        pmi_reference_url="https://www.acs.org/green-chemistry-sustainability/green-chemistry-nexus/articles/process-mass-intensity-calculation-tool.html",
    )


def _calculate_yield(body, materials, product, pure_mass, missing, notices):
    if body.yield_basis is None:
        missing.append("未指定限量原料与计量系数，摩尔收率未定义。")
        return None, None
    basis = body.yield_basis
    limiting = next(row for row in materials if row.id == basis.limiting_material_id)
    if limiting.structure is None or limiting.mass_g is None:
        missing.append("限量原料：计算摩尔收率需要结构与质量。")
        return None, None
    moles = limiting.mass_g * basis.limiting_purity_mass_percent / 100 / limiting.structure.molecular_weight_g_mol
    theoretical = moles * basis.product_coefficient / basis.reactant_coefficient * product.molecular_weight_g_mol
    notices.append("理论产物质量使用用户指定的限量原料和计量系数；不自动判断限量关系或反应是否配平。")
    if theoretical <= 0:
        notices.append("理论产物质量为零：计算收率未定义。")
        return theoretical, None
    return theoretical, None if pure_mass is None else pure_mass / theoretical * 100
