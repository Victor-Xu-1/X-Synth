from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .stock_index import IndexedCommercialStockRegistry, StockIndex


@dataclass(frozen=True)
class StockSource:
    name: str
    source_type: str
    consumers: tuple[str, ...]
    path: Path | None = None
    exact_structure_required: bool = True
    usable: bool = False
    evidence_role: str = "metadata"
    notes: str = ""

    def to_summary(self):
        return {
            "name": self.name,
            "type": self.source_type,
            "consumers": list(self.consumers),
            "exact_structure_required": self.exact_structure_required,
            "usable": self.usable,
            "evidence_role": self.evidence_role,
            "notes": self.notes,
        }


class UnifiedStockService:
    """One immutable indexed catalog, shared by native search and final closure."""

    def __init__(
        self, *, repo_root, external_stock_paths=None, online_decisions=None, env=None
    ):
        if external_stock_paths or online_decisions:
            raise ValueError(
                "Compile supplier evidence into the inventory snapshot before using it"
            )
        self.repo_root = Path(repo_root)
        environment = os.environ if env is None else env
        path = environment.get("X_SYNTH_STOCK_INDEX", "").strip()
        self.index = StockIndex(path) if path else None

    def stock_index(self):
        return self.index

    def sources(self):
        if self.index is None:
            return []
        return [
            StockSource(
                name="commercial_catalog",
                source_type="indexed_stock",
                consumers=("x_synth", "askcos", "route_closure"),
                path=self.index.path,
                usable=True,
                evidence_role="route_closure",
                notes="Exact supplier-catalog snapshot; not a live inventory promise.",
            )
        ]

    def summary(self):
        return {
            "status": "ready" if self.index is not None else "unavailable",
            "sources": [source.to_summary() for source in self.sources()],
            "snapshot": self.index.summary if self.index is not None else None,
            "policy": {
                "exact_structure_required": True,
                "weak_name_match_is_buyable": False,
                "similar_substructure_is_buyable": False,
            },
        }

    def load_registry(self):
        return (
            IndexedCommercialStockRegistry(self.index)
            if self.index is not None
            else None
        )
