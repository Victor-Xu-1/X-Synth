"""Typed product boundary for the supervised ASKCOS condition model."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from rdkit import rdBase

from packages.workspace.structure_validation import canonical_structure

from .native_models import NativeModelClient, NativeModelError


class IngredientIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(max_length=8192)
    smiles: str | None = None
    status: Literal["structure", "label_only", "not_predicted"]


def ingredient_identity(label):
    if not label:
        return IngredientIdentity(label=label, smiles=None, status="not_predicted")
    try:
        with rdBase.BlockLogs():
            smiles = canonical_structure(label, max_atoms=300)[0]
        return IngredientIdentity(label=label, smiles=smiles, status="structure")
    except ValueError:
        return IngredientIdentity(label=label, smiles=None, status="label_only")


class ConditionPrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    temperature: float = Field(ge=-273.15, allow_inf_nan=False)
    solvent: str = Field(max_length=8192)
    reagent: str = Field(max_length=8192)
    catalyst: str = Field(max_length=8192)
    score: float = Field(ge=0, le=1, allow_inf_nan=False)
    ingredients: dict[str, IngredientIdentity] | None = None


class ConditionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reactants: str
    product: str
    conditions: list[ConditionPrediction] = Field(max_length=20)
    model: str
    asset_identity: str = Field(pattern=r"^[a-f0-9]{64}$")
    evidence_type: str


ConditionModelError = NativeModelError


class ConditionAdapter:
    def __init__(self, base_url):
        self.client = NativeModelClient(base_url)

    def predict(self, *, reactants, product, count):
        try:
            reactants = canonical_structure(reactants, max_atoms=1024)[0]
            product = canonical_structure(product, max_atoms=1024)[0]
            result = ConditionResult.model_validate(
                self.client.post(
                    "/predict",
                    {"reactants": reactants, "product": product, "count": count},
                )
            )
            if (
                canonical_structure(result.reactants, max_atoms=1024)[0] != reactants
                or canonical_structure(result.product, max_atoms=1024)[0] != product
                or result.evidence_type != "model_prediction"
                or result.model != "nn_v1"
                or len(result.conditions) > count
            ):
                raise ValueError("Condition output is not bound to this reaction")
            result.reactants, result.product = reactants, product
            for row in result.conditions:
                row.ingredients = {
                    role: ingredient_identity(getattr(row, role))
                    for role in ("solvent", "reagent", "catalyst")
                }
            return result
        except ValueError as exc:
            raise ConditionModelError(
                "条件模型请求失败或返回格式无效，请重试。"
            ) from exc
