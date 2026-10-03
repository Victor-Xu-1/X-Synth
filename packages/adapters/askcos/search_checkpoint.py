"""Data-only native graph checkpoints at complete expansion boundaries."""

from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path

import networkx as nx

from packages.platform.atomic_file import write_json


def encode(value):
    if isinstance(value, float) and not math.isfinite(value):
        return {"__number__": "inf" if value > 0 else "-inf" if value < 0 else "nan"}
    if isinstance(value, dict):
        return {key: encode(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [encode(item) for item in value]
    if hasattr(value, "item"):
        return encode(value.item())
    return value


def decode(value):
    if isinstance(value, dict):
        if set(value) == {"__number__"}:
            return float(value["__number__"])
        return {key: decode(item) for key, item in value.items()}
    if isinstance(value, list):
        return [decode(item) for item in value]
    return value


class SearchCheckpoint:
    def __init__(self, path: Path, progress=lambda value: None):
        self.path, self.progress = path, progress
        self.identity = os.environ.get("X_SYNTH_ASSET_IDENTITY", "native-unconfigured")
        self.last_save = 0.0

    def restore(self, controller, target) -> float | None:
        if not self.path.exists():
            return None
        if self.path.stat().st_size > 256 * 1024**2:
            raise ValueError("Native checkpoint exceeds the graph budget")
        state = decode(json.loads(self.path.read_text(encoding="utf-8")))
        if (
            state.get("schema_version") != 1
            or state.get("asset_identity") != self.identity
            or state.get("target") != target
        ):
            raise ValueError(
                "Native checkpoint identity does not match configured assets"
            )
        controller.tree = nx.node_link_graph(state["graph"], edges="links")
        if not controller.tree.is_directed() or target not in controller.tree:
            raise ValueError("Invalid native checkpoint graph")
        controller.target = target
        controller.chemicals = type(controller.chemicals)(state["chemicals"])
        controller.reactions = type(controller.reactions)(state["reactions"])
        controller.iterations = state["iterations"]
        controller.time_to_solve = state["time_to_solve"]
        return state["elapsed"]

    def save(self, controller, elapsed, *, force=False):
        current = time.monotonic()
        if not force and current - self.last_save < 30:
            return
        write_json(
            self.path,
            encode(
                {
                    "schema_version": 1,
                    "asset_identity": self.identity,
                    "target": controller.target,
                    "graph": nx.node_link_data(controller.tree, edges="links"),
                    "chemicals": list(controller.chemicals),
                    "reactions": list(controller.reactions),
                    "iterations": controller.iterations,
                    "time_to_solve": controller.time_to_solve,
                    "elapsed": elapsed,
                }
            ),
        )
        self.last_save = current
        self.progress(
            {
                "iterations": controller.iterations,
                "chemicals": len(controller.chemicals),
                "reactions": len(controller.reactions),
                "elapsed_seconds": elapsed,
            }
        )
