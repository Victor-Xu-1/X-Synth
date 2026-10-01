from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
from typing import Iterable

from .commercial_stock import (
    CommercialStockRegistry,
    EvidenceDecision,
    load_commercial_stock_files,
    merge_commercial_stock_registries,
)


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

    def to_summary(self) -> dict:
        return {
            "name": self.name,
            "type": self.source_type,
            "consumers": list(self.consumers),
            "path": str(self.path) if self.path is not None else None,
            "exact_structure_required": self.exact_structure_required,
            "usable": self.usable,
            "evidence_role": self.evidence_role,
            "notes": self.notes,
        }


class UnifiedStockService:
    """Central registry for commercial stock and supplier evidence sources.

    This service deliberately separates source discovery from route closure.
    Native ASKCOS/AiZynthFinder files are managed here, but only exact-evidence
    Synon stock artifacts or online supplier decisions are merged into the
    route-closure registry.
    """

    def __init__(
        self,
        *,
        repo_root: Path | str,
        external_stock_paths: Iterable[Path | str] | None = None,
        online_decisions: Iterable[EvidenceDecision] | None = None,
        env: dict[str, str] | None = None,
    ) -> None:
        self.repo_root = Path(repo_root)
        self._external_stock_paths = [Path(path) for path in (external_stock_paths or [])]
        self._online_decisions = list(online_decisions or [])
        self._env = env if env is not None else os.environ

    def summary(self) -> dict:
        sources = self.sources()
        return {
            "repo_root": str(self.repo_root),
            "sources": [source.to_summary() for source in sources],
            "closure_stock_paths": self.external_stock_paths(),
            "online_suppliers": self.enabled_online_suppliers(),
            "policy": {
                "exact_structure_required": True,
                "weak_name_match_is_buyable": False,
                "similar_substructure_is_buyable": False,
            },
        }

    def sources(self) -> list[StockSource]:
        sources: list[StockSource] = [
            self._file_source(
                name="compiled_commercial_stock",
                source_type="compiled_stock",
                consumers=("synon", "route_closure"),
                path=self.repo_root / "data" / "compiled" / "commercial_stock" / "synon_stock.json",
                evidence_role="route_closure",
                notes="Merged commercial stock evidence used by Synon route closure.",
            ),
            self._file_source(
                name="compiled_domestic_stock",
                source_type="compiled_stock",
                consumers=("synon", "domestic_suppliers", "route_closure"),
                path=self.repo_root / "data" / "compiled" / "domestic_stock" / "synon_stock.json",
                evidence_role="route_closure",
                notes="Domestic supplier stock normalized to Synon evidence; current large import uses PubChem SourceName records for Aladdin, Ambeed, ChemScene, Combi-Blocks, Sigma-Aldrich, and TargetMol.",
            ),
            self._glob_source(
                name="askcos_buyables_raw",
                source_type="native_engine_stock",
                consumers=("askcos", "stock_compiler"),
                root=self.repo_root / "apps" / "askcos-v2" / "askcos2_core" / "data" / "db" / "buyables",
                patterns=("*.json.gz", "*.json", "*.csv", "*.tsv"),
                notes="Native ASKCOS buyables; compile before using as Synon route evidence.",
            ),
            self._file_source(
                name="aizynthfinder_zinc_stock",
                source_type="native_engine_stock",
                consumers=("aizynthfinder",),
                path=self.repo_root / "engines" / "aizynthfinder" / "models" / "zinc_stock.hdf5",
                notes="Native AiZynthFinder HDF5 stock for its own terminal check.",
            ),
            self._glob_source(
                name="operator_supplier_import_cache",
                source_type="operator_supplier_cache",
                consumers=("stock_compiler",),
                root=self.repo_root / "data" / "sources",
                patterns=("*.csv", "*.tsv", "*.json", "*.jsonl", "*.ndjson"),
                notes="Optional operator-supplied supplier exports; not part of the runtime route-closure chain until compiled into domestic_stock/synon_stock.json.",
            ),
            StockSource(
                name="pubchem_suppliers",
                source_type="online_supplier_resolver",
                consumers=("synon", "route_closure"),
                usable="pubchem" in self.enabled_online_suppliers(),
                evidence_role="online_exact_evidence",
                notes="Online supplier lookup; accepted only when PubChem structure and vendor evidence match exactly.",
            ),
            *self._manual_sources(),
        ]
        return sources

    def external_stock_paths(self) -> list[str]:
        if self._env_flag("SYNON_DISABLE_COMPILED_STOCK"):
            candidates = [*self._external_stock_paths, *self._env_external_stock_paths()]
        else:
            candidates = [
                *self._external_stock_paths,
                *self._env_external_stock_paths(),
                self.repo_root / "data" / "compiled" / "commercial_stock" / "synon_stock.json",
                self.repo_root / "data" / "compiled" / "domestic_stock" / "synon_stock.json",
            ]
        return [
            str(path)
            for path in _unique_paths(candidates)
            if _stock_path_has_accepted_records(path)
        ]

    def enabled_online_suppliers(self) -> list[str]:
        raw = self._env.get("SYNON_ONLINE_SUPPLIERS", "")
        if not raw.strip():
            return []
        allowed = {"pubchem"}
        normalized = raw.replace("\n", ";").replace(",", ";")
        return [
            supplier
            for supplier in _unique_strings(item.strip() for item in normalized.split(";") if item.strip())
            if supplier in allowed
        ]

    def load_registry(self) -> CommercialStockRegistry | None:
        registries: list[CommercialStockRegistry | None] = []
        stock_paths = self.external_stock_paths()
        if stock_paths:
            registries.append(load_commercial_stock_files(stock_paths))
        if self._online_decisions:
            registries.append(CommercialStockRegistry(self._online_decisions))
        return merge_commercial_stock_registries(registries)

    def aizynthfinder_stock_sources(self) -> list[str]:
        return [
            str(source.path)
            for source in self.sources()
            if "aizynthfinder" in source.consumers and source.path is not None and source.path.exists()
        ]

    def _manual_sources(self) -> list[StockSource]:
        return [
            StockSource(
                name=f"manual_stock_{index}",
                source_type="operator_supplied_stock",
                consumers=("synon", "route_closure"),
                path=path,
                usable=_stock_path_has_accepted_records(path),
                evidence_role="route_closure",
                notes="Operator supplied exact stock file from SYNON_EXTERNAL_STOCK_PATHS or request payload.",
            )
            for index, path in enumerate(_unique_paths([*self._external_stock_paths, *self._env_external_stock_paths()]), start=1)
        ]

    def _file_source(
        self,
        *,
        name: str,
        source_type: str,
        consumers: tuple[str, ...],
        path: Path,
        evidence_role: str = "metadata",
        notes: str,
    ) -> StockSource:
        usable = _stock_path_has_accepted_records(path) if evidence_role == "route_closure" else path.is_file()
        return StockSource(
            name=name,
            source_type=source_type,
            consumers=consumers,
            path=path,
            usable=usable,
            evidence_role=evidence_role,
            notes=notes,
        )

    def _glob_source(
        self,
        *,
        name: str,
        source_type: str,
        consumers: tuple[str, ...],
        root: Path,
        patterns: tuple[str, ...],
        notes: str,
    ) -> StockSource:
        usable = False
        if root.exists():
            usable = any(_has_any(root, pattern) for pattern in patterns)
        return StockSource(
            name=name,
            source_type=source_type,
            consumers=consumers,
            path=root,
            usable=usable,
            evidence_role="metadata",
            notes=notes,
        )

    def _env_external_stock_paths(self) -> list[Path]:
        raw = self._env.get("SYNON_EXTERNAL_STOCK_PATHS", "")
        if not raw.strip():
            return []
        normalized = raw.replace("\n", ";").replace(",", ";")
        return [Path(item.strip()) for item in normalized.split(";") if item.strip()]

    def _env_flag(self, name: str) -> bool:
        return self._env.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _stock_path_has_accepted_records(path: Path | str) -> bool:
    stock_path = Path(path)
    if not stock_path.is_file():
        return False
    try:
        if stock_path.stat().st_size <= 0:
            return False
        suffix = stock_path.suffix.lower()
        if suffix == ".json":
            return _json_stock_has_accepted_records(stock_path)
        with stock_path.open("r", encoding="utf-8-sig", errors="ignore") as handle:
            return any(line.strip() and not line.lstrip().startswith("#") for line in handle)
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False


def _json_stock_has_accepted_records(path: Path) -> bool:
    # Avoid loading 100MB+ stock files just to prove they are configured.
    with path.open("r", encoding="utf-8-sig", errors="ignore") as handle:
        head = handle.read(2_000_000)
    stripped = head.lstrip()
    if not stripped or stripped in {"[]", "{}"}:
        return False
    return '"smiles"' in head or '"SMILES"' in head or '"canonical_smiles"' in head


def _unique_paths(paths: Iterable[Path | str]) -> list[Path]:
    seen: set[str] = set()
    result: list[Path] = []
    for path in paths:
        normalized = str(Path(path))
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(Path(path))
    return result


def _unique_strings(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _has_any(root: Path, pattern: str) -> bool:
    try:
        next(root.rglob(pattern))
        return True
    except StopIteration:
        return False
