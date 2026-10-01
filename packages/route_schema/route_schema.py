from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class RouteStep:
    step_id: str
    reaction_smiles: str
    precursors: list[str]
    product: str
    source: str
    confidence: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RouteCandidate:
    route_id: str
    engine: str
    target_smiles: str
    steps: list[RouteStep] = field(default_factory=list)
    starting_materials: list[str] = field(default_factory=list)
    closed: bool = False
    closure_sources: list[str] = field(default_factory=list)
    route_score: float | None = None
    family_key: str | None = None
    evidence_refs: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
