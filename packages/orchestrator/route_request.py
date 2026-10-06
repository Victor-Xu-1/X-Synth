from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from rdkit import Chem

from packages.adapters.stock.commercial_stock import canonicalize_smiles
from packages.platform.performance import PerformanceBudget
from packages.chemistry.material_scope import material_scope_exclusion


class SearchTuning(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_depth: int = Field(default=12, ge=3, le=50)
    max_branching: int = Field(default=50, ge=1, le=200)
    template_count: int = Field(default=1000, ge=10, le=5000)
    cumulative_probability: float = Field(default=0.999, gt=0, le=1)
    minimum_plausibility: float = Field(default=0.75, ge=0, le=1)


class RouteJobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    smiles: str = Field(min_length=1, max_length=20_000)
    description: str | None = Field(default=None, max_length=1000)
    backend: Literal["askcos"] = "askcos"
    search_policy_version: int = Field(default=2, strict=True, ge=1, le=2)
    strategies: list[Literal["mcts", "retro_star"]] = Field(
        default_factory=lambda: ["mcts", "retro_star"], min_length=1, max_length=2
    )
    expansion_time: int = Field(default=1800, ge=60, le=7200)
    max_paths: int = Field(default=200, ge=10, le=500)
    min_routes: int = Field(default=3, ge=3, le=10)
    max_routes: int = Field(default=10, ge=3, le=10)
    repair_attempts: int = Field(default=1, ge=0, le=1)
    tuning: SearchTuning = Field(default_factory=SearchTuning)
    public: Literal[False] = False

    @classmethod
    def from_persisted(cls, value: dict):
        # Pre-versioned jobs retain their original child-input hashes on resume.
        return cls(**{
            **value, "search_policy_version": value.get("search_policy_version", 1),
        })

    @model_validator(mode="after")
    def validate_structure_and_range(self):
        raw = Chem.MolFromSmiles(self.smiles, sanitize=False)
        if (
            raw is not None
            and raw.GetNumAtoms()
            > PerformanceBudget.from_environment().max_structure_atoms
        ):
            raise ValueError("Molecular input exceeds the supported atom budget")
        canonical = canonicalize_smiles(self.smiles)
        if not canonical:
            raise ValueError("Invalid molecular structure")
        if material_scope_exclusion(canonical):
            raise ValueError("该目标物料超出当前普通研究合成规划范围。")
        if self.min_routes > self.max_routes:
            raise ValueError("Minimum route count exceeds maximum route count")
        self.smiles = canonical
        self.strategies = list(dict.fromkeys(self.strategies))
        return self
