"""Keep the full native output privately; deliver all enumerated routes compactly."""

from __future__ import annotations

import json
from pathlib import Path

from packages.platform.atomic_file import write_json
from packages.platform.performance import PerformanceBudget


def route_projection(payload: dict, *, target: str) -> dict:
    uds = payload.get("uds")
    if not isinstance(uds, dict) or not isinstance(uds.get("node_dict"), dict):
        raise TypeError("Invalid native route representation")
    identifiers = uds.get("uuid2smiles")
    pathways = uds.get("pathways")
    if not isinstance(identifiers, dict) or not isinstance(pathways, list):
        raise TypeError("Invalid native route connectivity")
    needed = {target, *identifiers.values()}
    if any(smiles not in uds["node_dict"] for smiles in needed):
        raise ValueError("Native routes reference missing nodes")
    graph = [
        edge
        for edge in uds.get("graph", [])
        if edge.get("source") in needed and edge.get("target") in needed
    ]
    compact = {
        **uds,
        "node_dict": {smiles: uds["node_dict"][smiles] for smiles in needed},
        "graph": graph,
    }
    return {**payload, "uds": compact, "explored_graph_preserved": True}


class SearchArtifacts:
    def __init__(self, root: Path):
        self.root = root
        self.budget = PerformanceBudget.from_environment()

    def save(self, identifier: str, payload: dict, *, target: str):
        # Full output and its checkpoint are never replaced by the HTTP projection.
        write_json(self.root / (identifier + ".raw-result.json"), payload)
        compact = route_projection(payload, target=target)
        path = self.root / (identifier + ".routes.json")
        encoded_size = len(
            json.dumps(compact, ensure_ascii=False, allow_nan=False).encode()
        )
        if encoded_size > self.budget.response_bytes:
            raise ValueError("Enumerated routes exceed the native response budget")
        write_json(path, compact)

    def result_path(self, identifier: str):
        path = self.root / (identifier + ".routes.json")
        if (
            not path.is_file()
            or path.is_symlink()
            or path.stat().st_size > self.budget.response_bytes
        ):
            raise ValueError("Native route artifact unavailable or oversized")
        return path
