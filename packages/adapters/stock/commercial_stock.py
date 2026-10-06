from __future__ import annotations

import csv
import json
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal

from packages.route_schema.route_schema import RouteCandidate, RouteStep

Decision = Literal["accepted", "rejected", "ambiguous"]


@dataclass(frozen=True)
class EvidenceDecision:
    smiles: str
    source: str
    decision: Decision
    reason: str
    catalog_id: str | None = None
    cas: str | None = None
    url: str | None = None


class CommercialStockRegistry:
    def __init__(
        self,
        decisions: list[EvidenceDecision],
        *,
        canonicalize_decisions: bool = True,
    ) -> None:
        if canonicalize_decisions:
            self._decisions = [
                replace(decision, smiles=canonicalize_smiles(decision.smiles))
                for decision in decisions
            ]
        else:
            self._decisions = [
                replace(decision, smiles=(decision.smiles or "").strip())
                for decision in decisions
            ]
        self._decision_index: dict[str, list[EvidenceDecision]] = {}
        for decision in self._decisions:
            self._decision_index.setdefault(decision.smiles, []).append(decision)

    @property
    def decisions(self) -> list[EvidenceDecision]:
        return list(self._decisions)

    def decisions_for(self, smiles: str) -> list[EvidenceDecision]:
        return list(self._decision_index.get(canonicalize_smiles(smiles), []))

    def is_buyable(self, smiles: str) -> bool:
        return any(
            decision.decision == "accepted" for decision in self.decisions_for(smiles)
        )

    def accepted_smiles(self, *, limit: int | None = None) -> list[str]:
        seen: set[str] = set()
        smiles_values: list[str] = []
        for decision in self._decisions:
            if decision.decision != "accepted":
                continue
            smiles = decision.smiles.strip()
            if not smiles or smiles in seen:
                continue
            seen.add(smiles)
            smiles_values.append(smiles)
            if limit is not None and len(smiles_values) >= limit:
                break
        return smiles_values

    def accepted_decision_count(self, *, limit: int | None = None) -> int:
        count = 0
        for decision in self._decisions:
            if decision.decision != "accepted":
                continue
            count += 1
            if limit is not None and count >= limit:
                break
        return count

    def accepted_sources(self, smiles: str) -> list[str]:
        return [
            decision.source
            for decision in self.decisions_for(smiles)
            if decision.decision == "accepted"
        ]

    def rejected_reasons(self, smiles: str) -> list[str]:
        return [
            decision.reason
            for decision in self.decisions_for(smiles)
            if decision.decision in {"rejected", "ambiguous"}
        ]

    def close_route_if_buyable(self, route: RouteCandidate) -> RouteCandidate:
        """Mark a route closed when every reported unclosed leaf has exact stock evidence."""
        route = self._prune_route_at_buyable_intermediates(route)
        products = {canonicalize_smiles(step.product) for step in route.steps}
        required_leaves = _unique(
            [
                *route.starting_materials,
                *(
                    precursor
                    for step in route.steps
                    for precursor in step.precursors
                    if canonicalize_smiles(precursor) not in products
                ),
            ]
        )
        missing = [smiles for smiles in required_leaves if not self.is_buyable(smiles)]
        if missing:
            metadata = dict(route.metadata)
            metadata["unclosed_precursors"] = missing
            return replace(route, closed=False, metadata=metadata)
        if route.closed:
            source_labels = _accepted_source_labels_for(route.starting_materials, self)
            if not source_labels:
                return route
            metadata = dict(route.metadata)
            metadata["external_stock_closure"] = sorted(
                {*metadata.get("external_stock_closure", []), *source_labels}
            )
            return replace(
                route,
                closure_sources=_unique([*route.closure_sources, *source_labels]),
                metadata=metadata,
            )

        metadata = dict(route.metadata)
        unclosed = list(metadata.get("unclosed_precursors") or route.starting_materials)
        remaining_unclosed = [
            smiles for smiles in unclosed if not self.is_buyable(smiles)
        ]
        if remaining_unclosed:
            metadata["unclosed_precursors"] = remaining_unclosed
            return replace(route, metadata=metadata)

        source_labels: list[str] = []
        for smiles in unclosed:
            for decision in self.decisions_for(smiles):
                if decision.decision == "accepted":
                    source_labels.append(_source_label(decision))

        metadata["unclosed_precursors"] = []
        metadata["external_stock_closure"] = sorted(set(source_labels))
        return replace(
            route,
            closed=True,
            closure_sources=_unique([*route.closure_sources, *source_labels]),
            metadata=metadata,
        )

    def _prune_route_at_buyable_intermediates(
        self, route: RouteCandidate
    ) -> RouteCandidate:
        """Stop traversing a route branch once its product has exact stock evidence."""
        if len(route.steps) < 2:
            return route

        target_key = canonicalize_smiles(route.target_smiles)
        step_by_product: dict[str, RouteStep] = {}
        for step in route.steps:
            product_key = canonicalize_smiles(step.product)
            if product_key and product_key not in step_by_product:
                step_by_product[product_key] = step
        root_step = step_by_product.get(target_key)
        if root_step is None:
            return route

        retained_step_ids: set[str] = set()
        active_products: set[str] = set()
        starting_materials: list[str] = []
        pruned_intermediates: list[str] = []

        def append_starting_material(smiles: str) -> None:
            key = canonicalize_smiles(smiles)
            if not key:
                return
            if any(canonicalize_smiles(item) == key for item in starting_materials):
                return
            starting_materials.append(smiles)

        def visit(product_key: str) -> None:
            if product_key in active_products:
                return
            step = step_by_product.get(product_key)
            if step is None:
                return
            active_products.add(product_key)
            retained_step_ids.add(step.step_id)
            for precursor in step.precursors:
                precursor_key = canonicalize_smiles(precursor)
                producer = step_by_product.get(precursor_key)
                if precursor_key != target_key and self.is_buyable(precursor):
                    append_starting_material(precursor)
                    if producer is not None and precursor not in pruned_intermediates:
                        pruned_intermediates.append(precursor)
                    continue
                if producer is not None:
                    visit(precursor_key)
                else:
                    append_starting_material(precursor)
            active_products.remove(product_key)

        visit(target_key)
        retained_steps = [
            step for step in route.steps if step.step_id in retained_step_ids
        ]
        if len(retained_steps) == len(route.steps):
            return route

        metadata = dict(route.metadata)
        metadata["stock_pruned_intermediates"] = _unique(
            [*metadata.get("stock_pruned_intermediates", []), *pruned_intermediates]
        )
        metadata["stock_pruned_step_count"] = len(route.steps) - len(retained_steps)
        metadata["unclosed_precursors"] = [
            smiles for smiles in starting_materials if not self.is_buyable(smiles)
        ]
        return replace(
            route,
            steps=retained_steps,
            starting_materials=starting_materials,
            route_score=None,
            metadata=metadata,
        )


def merge_commercial_stock_registries(
    registries: list[CommercialStockRegistry | None],
) -> CommercialStockRegistry | None:
    available = [registry for registry in registries if registry is not None]
    if not available:
        return None
    if len(available) == 1:
        return available[0]
    return CompositeStockRegistry(available)


class CompositeStockRegistry(CommercialStockRegistry):
    def __init__(self, registries: list[CommercialStockRegistry]) -> None:
        super().__init__([], canonicalize_decisions=False)
        self.registries = registries

    @property
    def decisions(self) -> list[EvidenceDecision]:
        return [
            decision for registry in self.registries for decision in registry.decisions
        ]

    def decisions_for(self, smiles: str) -> list[EvidenceDecision]:
        return [
            decision
            for registry in self.registries
            for decision in registry.decisions_for(smiles)
        ]

    def accepted_decision_count(self, *, limit: int | None = None) -> int:
        count = sum(
            registry.accepted_decision_count(limit=limit)
            for registry in self.registries
        )
        return min(count, limit) if limit is not None else count

    def accepted_smiles(self, *, limit: int | None = None) -> list[str]:
        values = []
        seen = set()
        for registry in self.registries:
            for smiles in registry.accepted_smiles(limit=limit):
                if smiles not in seen:
                    values.append(smiles)
                    seen.add(smiles)
                if limit is not None and len(values) >= limit:
                    return values
        return values


def load_commercial_stock_file(path: Path | str) -> CommercialStockRegistry:
    """Load operator-supplied stock evidence from CSV/TSV/SMI/JSONL using exact structures."""
    source_path = Path(path)
    suffix = source_path.suffix.lower()
    text = source_path.read_text(encoding="utf-8-sig")
    if suffix in {".csv", ".tsv"}:
        delimiter = "\t" if suffix == ".tsv" else ","
        rows = csv.DictReader(text.splitlines(), delimiter=delimiter)
        decisions = [
            _decision_from_row(row, default_source=source_path.stem) for row in rows
        ]
    elif suffix in {".smi", ".smiles"}:
        decisions = [
            _decision_from_smi_line(line, default_source=source_path.stem)
            for line in text.splitlines()
        ]
    elif suffix in {".jsonl", ".ndjson"}:
        decisions = [
            _decision_from_row(json.loads(line), default_source=source_path.stem)
            for line in text.splitlines()
            if line.strip()
        ]
    elif suffix == ".json":
        payload = json.loads(text)
        rows = payload if isinstance(payload, list) else payload.get("records", [])
        decisions = [
            _decision_from_row(row, default_source=source_path.stem) for row in rows
        ]
        return CommercialStockRegistry(
            [decision for decision in decisions if decision is not None],
        )
    else:
        raise ValueError(f"unsupported stock file format: {source_path}")
    return CommercialStockRegistry(
        [decision for decision in decisions if decision is not None]
    )


def load_commercial_stock_files(paths: list[Path | str]) -> CommercialStockRegistry:
    decisions: list[EvidenceDecision] = []
    for path in paths:
        decisions.extend(load_commercial_stock_file(path)._decisions)
    return CommercialStockRegistry(decisions, canonicalize_decisions=False)


def canonicalize_smiles(smiles: str) -> str:
    value = (smiles or "").strip()
    if not value:
        return value
    from rdkit import Chem

    mol = Chem.MolFromSmiles(value)
    if mol is None:
        return ""
    for atom in mol.GetAtoms():
        atom.SetAtomMapNum(0)
    return Chem.MolToSmiles(mol, canonical=True, isomericSmiles=True)


def _decision_from_row(row: dict, *, default_source: str) -> EvidenceDecision | None:
    smiles = str(
        row.get("smiles") or row.get("SMILES") or row.get("canonical_smiles") or ""
    ).strip()
    if not smiles:
        return None
    source = (
        str(row.get("source") or row.get("supplier") or default_source).strip()
        or default_source
    )
    decision = str(row.get("decision") or "accepted").strip().lower()
    if decision not in {"accepted", "rejected", "ambiguous"}:
        decision = "ambiguous"
    reason = str(
        row.get("reason") or "operator supplied exact structure stock evidence"
    ).strip()
    from .supplier_evidence import supplier_record

    if decision == "accepted":
        record = supplier_record({
            **row, "smiles": smiles, "source": source,
            "catalog_id": row.get("catalog_id") or row.get("catalog") or row.get("sku"),
            "url": row.get("url") or row.get("URL"),
        })
        if record is None:
            decision = "ambiguous"
            reason = "Imported metadata did not pass the exact supplier-catalog gate"
        else:
            smiles, source = record["smiles"], record["source"]
            row = {**row, **record}
            reason = record["reason"]
    return EvidenceDecision(
        smiles=smiles,
        source=source,
        decision=decision,  # type: ignore[arg-type]
        reason=reason,
        catalog_id=_optional_str(
            row.get("catalog_id") or row.get("catalog") or row.get("sku")
        ),
        cas=_optional_str(row.get("cas") or row.get("CAS")),
        url=_optional_str(row.get("url") or row.get("URL")),
    )


def _decision_from_smi_line(
    line: str, *, default_source: str
) -> EvidenceDecision | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    parts = stripped.split()
    smiles = parts[0]
    catalog_id = parts[1] if len(parts) > 1 else None
    source = parts[2] if len(parts) > 2 else default_source
    return _decision_from_row({
        "smiles": smiles, "source": source, "catalog_id": catalog_id,
        "url": parts[3] if len(parts) > 3 else None,
    }, default_source=default_source)


def _source_label(decision: EvidenceDecision) -> str:
    if decision.catalog_id:
        return f"{decision.source}:{decision.catalog_id}"
    return decision.source


def _accepted_source_labels_for(
    smiles_values: list[str],
    registry: CommercialStockRegistry,
) -> list[str]:
    labels: list[str] = []
    for smiles in smiles_values:
        for decision in registry.decisions_for(smiles):
            if decision.decision == "accepted":
                labels.append(_source_label(decision))
    return _unique(labels)


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
