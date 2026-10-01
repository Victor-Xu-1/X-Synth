from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ASKCOSAdapter:
    base_url: str

    def build_tree_builder_payload(self, smiles: str, max_trees: int = 10) -> dict[str, Any]:
        return {
            "smiles": smiles,
            "max_trees": max_trees,
            "return_first": False,
            "search_policy": "highest_quality",
        }
