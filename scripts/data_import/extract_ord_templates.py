#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import sys
import time
import urllib.request
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse


@dataclass(frozen=True)
class OrdReactionRow:
    reaction_id: str
    dataset_name: str
    source_path: str
    rxn_smiles: str
    mapped_rxn_smiles: str
    status: str
    reason: str
    template_smarts: str


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Extract ASKCOS-compatible retro templates from real Open Reaction "
            "Database .pb.gz files. Unmapped reactions are audited and do not "
            "enter the template library unless atom mapping is supplied."
        )
    )
    parser.add_argument(
        "--ord-data-dir",
        type=Path,
        default=Path("data/external/ord-data/data"),
        help="Directory containing official ORD .pb.gz files.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/compiled/ord_templates"),
        help="Output directory for extracted templates and audit files.",
    )
    parser.add_argument("--max-files", type=int, default=None)
    parser.add_argument("--limit-reactions", type=int, default=None)
    parser.add_argument(
        "--file-shard-index",
        type=int,
        default=None,
        help="0-based ORD source-file shard index for parallel full extraction.",
    )
    parser.add_argument(
        "--file-shard-count",
        type=int,
        default=None,
        help="Total source-file shard count for parallel full extraction.",
    )
    parser.add_argument(
        "--atom-map-url",
        default="",
        help="Optional ASKCOS atom-map call-sync URL used for unmapped reactions.",
    )
    parser.add_argument("--atom-map-backend", default="rxnmapper")
    parser.add_argument("--atom-map-batch-size", type=int, default=16)
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=5000,
        help="Write resumable checkpoint/template snapshots after this many processed reactions.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from checkpoint.json and partial template snapshot in the output directory.",
    )
    args = parser.parse_args()

    extractor = OrdTemplateExtractor(
        ord_data_dir=args.ord_data_dir,
        output_dir=args.output_dir,
        atom_map_url=args.atom_map_url.strip(),
        atom_map_backend=args.atom_map_backend,
        atom_map_batch_size=max(1, args.atom_map_batch_size),
    )
    summary = extractor.run(
        max_files=args.max_files,
        limit_reactions=args.limit_reactions,
        file_shard_index=args.file_shard_index,
        file_shard_count=args.file_shard_count,
        checkpoint_every=max(1, args.checkpoint_every),
        resume=args.resume,
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


class OrdTemplateExtractor:
    def __init__(
        self,
        *,
        ord_data_dir: Path,
        output_dir: Path,
        atom_map_url: str,
        atom_map_backend: str,
        atom_map_batch_size: int,
    ) -> None:
        self.ord_data_dir = ord_data_dir
        self.output_dir = output_dir
        self.atom_map_url = atom_map_url
        self.atom_map_backend = atom_map_backend
        self.atom_map_batch_size = atom_map_batch_size

    def run(
        self,
        *,
        max_files: int | None,
        limit_reactions: int | None,
        file_shard_index: int | None,
        file_shard_count: int | None,
        checkpoint_every: int,
        resume: bool,
    ) -> dict[str, Any]:
        dataset_pb2, reaction_pb2 = _load_ord_schema()
        extract_from_reaction = _load_template_extractor()

        source_paths = sorted(self.ord_data_dir.rglob("*.pb.gz"))
        if max_files is not None:
            source_paths = source_paths[:max_files]
        source_paths = _apply_file_shard(
            source_paths,
            file_shard_index=file_shard_index,
            file_shard_count=file_shard_count,
        )
        if not source_paths:
            raise FileNotFoundError(f"No ORD .pb.gz files found under {self.ord_data_dir}")

        self.output_dir.mkdir(parents=True, exist_ok=True)
        audit_path = self.output_dir / "ord_reactions.csv.gz"
        template_path = self.output_dir / "retro.templates.ord_extracted.json.gz"
        partial_template_path = self.output_dir / "retro.templates.ord_extracted.partial.json.gz"
        summary_path = self.output_dir / "summary.json"
        checkpoint_path = self.output_dir / "checkpoint.json"

        counters: Counter[str] = Counter()
        templates: dict[str, dict[str, Any]] = {}
        pending_unmapped: list[tuple[str, str, str, str, str]] = []
        processed_reactions = 0
        resume_processed_reactions = 0
        start = time.time()

        if resume:
            checkpoint = _load_checkpoint(checkpoint_path)
            if checkpoint is None:
                raise FileNotFoundError(
                    f"Cannot resume ORD extraction because {checkpoint_path} does not exist."
                )
            resume_processed_reactions = int(checkpoint.get("processed_reactions") or 0)
            processed_reactions = resume_processed_reactions
            counters.update({str(key): int(value) for key, value in checkpoint.get("counters", {}).items()})
            resume_template_path = partial_template_path if partial_template_path.exists() else template_path
            templates.update(_load_template_map(resume_template_path))

        audit_mode = "at" if resume and audit_path.exists() else "wt"
        with gzip.open(audit_path, audit_mode, encoding="utf-8", newline="") as audit_handle:
            writer = csv.DictWriter(
                audit_handle,
                fieldnames=[
                    "reaction_id",
                    "dataset_name",
                    "source_path",
                    "rxn_smiles",
                    "mapped_rxn_smiles",
                    "status",
                    "reason",
                    "template_smarts",
                ],
            )
            if audit_mode == "wt":
                writer.writeheader()
            seen_reactions = 0
            last_checkpoint_at = processed_reactions

            def write_checkpoint_snapshot(*, force: bool = False) -> None:
                nonlocal last_checkpoint_at
                if not force and processed_reactions - last_checkpoint_at < checkpoint_every:
                    return
                if pending_unmapped:
                    self._flush_mapped_batch(
                        pending_unmapped,
                        extract_from_reaction,
                        writer,
                        templates,
                        counters,
                    )
                audit_handle.flush()
                _write_templates(partial_template_path, templates)
                _write_checkpoint(
                    checkpoint_path,
                    self._checkpoint_payload(
                        source_paths=source_paths,
                        file_shard_index=file_shard_index,
                        file_shard_count=file_shard_count,
                        processed_reactions=processed_reactions,
                        counters=counters,
                        templates=templates,
                        template_path=partial_template_path,
                        audit_path=audit_path,
                        start=start,
                        completed=False,
                    ),
                )
                last_checkpoint_at = processed_reactions

            for source_path in source_paths:
                dataset = dataset_pb2.Dataset()
                with gzip.open(source_path, "rb") as handle:
                    dataset.ParseFromString(handle.read())
                dataset_name = dataset.name or source_path.stem
                for reaction in dataset.reactions:
                    seen_reactions += 1
                    if seen_reactions <= resume_processed_reactions:
                        continue
                    if limit_reactions is not None and processed_reactions >= limit_reactions:
                        break
                    processed_reactions += 1
                    rxn_smiles = _reaction_smiles(reaction, reaction_pb2)
                    reaction_id = reaction.reaction_id or _short_hash(
                        f"{source_path}:{processed_reactions}:{rxn_smiles}"
                    )
                    if not rxn_smiles:
                        row = OrdReactionRow(
                            reaction_id=reaction_id,
                            dataset_name=dataset_name,
                            source_path=str(source_path),
                            rxn_smiles="",
                            mapped_rxn_smiles="",
                            status="rejected",
                            reason="missing_reactant_or_product_smiles",
                            template_smarts="",
                        )
                        _write_audit_row(writer, row)
                        counters[row.reason] += 1
                        write_checkpoint_snapshot()
                        continue

                    counters["reaction_smiles"] += 1
                    if _has_atom_mapping(rxn_smiles):
                        row = _extract_template_row(
                            extract_from_reaction=extract_from_reaction,
                            reaction_id=reaction_id,
                            dataset_name=dataset_name,
                            source_path=str(source_path),
                            rxn_smiles=rxn_smiles,
                            mapped_rxn_smiles=rxn_smiles,
                        )
                        _write_audit_row(writer, row)
                        _merge_template(templates, row)
                        counters[row.status] += 1
                        if row.reason:
                            counters[row.reason] += 1
                    elif self.atom_map_url:
                        pending_unmapped.append(
                            (reaction_id, dataset_name, str(source_path), rxn_smiles, rxn_smiles)
                        )
                        if len(pending_unmapped) >= self.atom_map_batch_size:
                            self._flush_mapped_batch(pending_unmapped, extract_from_reaction, writer, templates, counters)
                    else:
                        row = OrdReactionRow(
                            reaction_id=reaction_id,
                            dataset_name=dataset_name,
                            source_path=str(source_path),
                            rxn_smiles=rxn_smiles,
                            mapped_rxn_smiles="",
                            status="rejected",
                            reason="missing_atom_mapping",
                            template_smarts="",
                        )
                        _write_audit_row(writer, row)
                        counters[row.status] += 1
                        counters[row.reason] += 1
                    write_checkpoint_snapshot()
                if limit_reactions is not None and processed_reactions >= limit_reactions:
                    break
            if pending_unmapped:
                self._flush_mapped_batch(pending_unmapped, extract_from_reaction, writer, templates, counters)
            write_checkpoint_snapshot(force=True)

        ordered_templates = _write_templates(template_path, templates)
        _write_templates(partial_template_path, templates)

        summary = {
            "source": "Open Reaction Database",
            "source_dir": str(self.ord_data_dir),
            "source_files": len(source_paths),
            "file_shard_index": file_shard_index,
            "file_shard_count": file_shard_count,
            "processed_reactions": processed_reactions,
            "reaction_smiles": counters["reaction_smiles"],
            "accepted_templates": len(ordered_templates),
            "accepted_template_occurrences": sum(int(row["count"]) for row in ordered_templates),
            "rejected_reactions": counters["rejected"],
            "counters": dict(sorted(counters.items())),
            "atom_map_url": self.atom_map_url or None,
            "template_path": str(template_path),
            "audit_path": str(audit_path),
            "checkpoint_path": str(checkpoint_path),
            "partial_template_path": str(partial_template_path),
            "resumed_from_processed_reactions": resume_processed_reactions if resume else 0,
            "elapsed_sec": round(time.time() - start, 3),
        }
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        _write_checkpoint(
            checkpoint_path,
            self._checkpoint_payload(
                source_paths=source_paths,
                file_shard_index=file_shard_index,
                file_shard_count=file_shard_count,
                processed_reactions=processed_reactions,
                counters=counters,
                templates=templates,
                template_path=template_path,
                audit_path=audit_path,
                start=start,
                completed=True,
            ),
        )
        return summary

    def _checkpoint_payload(
        self,
        *,
        source_paths: list[Path],
        file_shard_index: int | None,
        file_shard_count: int | None,
        processed_reactions: int,
        counters: Counter[str],
        templates: dict[str, dict[str, Any]],
        template_path: Path,
        audit_path: Path,
        start: float,
        completed: bool,
    ) -> dict[str, Any]:
        return {
            "source": "Open Reaction Database",
            "source_dir": str(self.ord_data_dir),
            "source_files": len(source_paths),
            "file_shard_index": file_shard_index,
            "file_shard_count": file_shard_count,
            "processed_reactions": processed_reactions,
            "reaction_smiles": counters["reaction_smiles"],
            "accepted_templates": len(templates),
            "accepted_template_occurrences": sum(int(row["count"]) for row in templates.values()),
            "rejected_reactions": counters["rejected"],
            "counters": dict(sorted(counters.items())),
            "atom_map_url": self.atom_map_url or None,
            "template_path": str(template_path),
            "audit_path": str(audit_path),
            "completed": completed,
            "updated_at_epoch": time.time(),
            "elapsed_sec": round(time.time() - start, 3),
        }

    def _flush_mapped_batch(
        self,
        pending: list[tuple[str, str, str, str, str]],
        extract_from_reaction: Any,
        writer: csv.DictWriter,
        templates: dict[str, dict[str, Any]],
        counters: Counter[str],
    ) -> None:
        batch = pending[:]
        pending.clear()
        mapped = self._map_reactions([row[3] for row in batch])
        for (reaction_id, dataset_name, source_path, rxn_smiles, _), mapped_rxn in zip(batch, mapped, strict=False):
            if not mapped_rxn:
                row = OrdReactionRow(
                    reaction_id=reaction_id,
                    dataset_name=dataset_name,
                    source_path=source_path,
                    rxn_smiles=rxn_smiles,
                    mapped_rxn_smiles="",
                    status="rejected",
                    reason="atom_mapping_failed",
                    template_smarts="",
                )
            else:
                row = _extract_template_row(
                    extract_from_reaction=extract_from_reaction,
                    reaction_id=reaction_id,
                    dataset_name=dataset_name,
                    source_path=source_path,
                    rxn_smiles=rxn_smiles,
                    mapped_rxn_smiles=mapped_rxn,
                )
            _write_audit_row(writer, row)
            _merge_template(templates, row)
            counters[row.status] += 1
            if row.reason:
                counters[row.reason] += 1

    def _map_reactions(self, rxn_smiles: list[str]) -> list[str | None]:
        if not rxn_smiles:
            return []
        try:
            mapped = self._map_reactions_once(rxn_smiles)
        except Exception:
            mapped = None
        if mapped is not None and len(mapped) == len(rxn_smiles):
            return mapped
        if len(rxn_smiles) == 1:
            return [None]
        midpoint = len(rxn_smiles) // 2
        return self._map_reactions(rxn_smiles[:midpoint]) + self._map_reactions(rxn_smiles[midpoint:])

    def _map_reactions_once(self, rxn_smiles: list[str]) -> list[str | None] | None:
        payload = {
            "backend": self.atom_map_backend,
            "smiles": rxn_smiles,
        }
        request = urllib.request.Request(
            self.atom_map_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        try:
            opener = _url_opener_for(self.atom_map_url)
            with opener.open(request, timeout=120) as response:
                data = json.loads(response.read().decode("utf-8"))
        except Exception:
            return None
        result = data.get("result") if isinstance(data, dict) else None
        if isinstance(result, list):
            return [_mapped_rxn_from_response_item(item) for item in result]

        raw_results = data.get("results") if isinstance(data, dict) else None
        if isinstance(raw_results, list) and raw_results:
            first_batch = raw_results[0]
            if isinstance(first_batch, list):
                return [_mapped_rxn_from_response_item(item) for item in first_batch]
        return None


def _apply_file_shard(
    source_paths: list[Path],
    *,
    file_shard_index: int | None,
    file_shard_count: int | None,
) -> list[Path]:
    if file_shard_index is None and file_shard_count is None:
        return source_paths
    if file_shard_index is None or file_shard_count is None:
        raise ValueError("--file-shard-index and --file-shard-count must be supplied together.")
    if file_shard_count < 1:
        raise ValueError("--file-shard-count must be at least 1.")
    if file_shard_index < 0 or file_shard_index >= file_shard_count:
        raise ValueError("--file-shard-index must be in [0, file_shard_count).")
    return [
        source_path
        for index, source_path in enumerate(source_paths)
        if index % file_shard_count == file_shard_index
    ]


def _load_checkpoint(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _write_checkpoint(path: Path, payload: dict[str, Any]) -> None:
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary_path.replace(path)


def _load_template_map(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"Cannot resume ORD extraction because {path} does not exist.")
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        rows = json.load(handle)
    templates: dict[str, dict[str, Any]] = {}
    for row in rows:
        reaction_smarts = str(row.get("reaction_smarts") or "").strip()
        if not reaction_smarts:
            continue
        entry = dict(row)
        entry["references"] = list(row.get("references") or [])
        entry["attributes"] = dict(row.get("attributes") or {})
        templates[reaction_smarts] = entry
    return templates


def _write_templates(path: Path, templates: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    ordered_templates = sorted(
        templates.values(),
        key=lambda item: (-int(item["count"]), str(item.get("reaction_smarts") or item.get("_id") or "")),
    )
    output: list[dict[str, Any]] = []
    for index, row in enumerate(ordered_templates):
        output_row = dict(row)
        output_row["references"] = list(row.get("references") or [])
        output_row["attributes"] = dict(row.get("attributes") or {})
        output_row["index"] = index
        output_row["_id"] = str(index)
        output.append(output_row)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    with gzip.open(temporary_path, "wt", encoding="utf-8") as handle:
        json.dump(output, handle, ensure_ascii=False)
    temporary_path.replace(path)
    return output


def _load_ord_schema():
    try:
        from ord_schema.proto import dataset_pb2, reaction_pb2
    except ImportError as exc:
        raise SystemExit(
            "ord-schema is required. Install in a venv, for example: "
            "python3 -m venv /tmp/synon-ord-venv && "
            "/tmp/synon-ord-venv/bin/python -m pip install ord-schema rdchiral pebble"
        ) from exc
    return dataset_pb2, reaction_pb2


def _url_opener_for(url: str) -> urllib.request.OpenerDirector:
    host = (urlparse(url).hostname or "").lower()
    if host in {"127.0.0.1", "localhost", "::1"}:
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener()


def _load_template_extractor():
    try:
        from rdchiral.template_extractor import extract_from_reaction
    except ImportError as exc:
        raise SystemExit("rdchiral is required for ORD template extraction.") from exc
    return extract_from_reaction


def _reaction_smiles(reaction: Any, reaction_pb2: Any) -> str:
    reactants = []
    for _, input_value in reaction.inputs.items():
        for component in input_value.components:
            role_name = component.DESCRIPTOR.fields_by_name["reaction_role"].enum_type.values_by_number[
                component.reaction_role
            ].name
            if role_name != "REACTANT":
                continue
            smiles = _component_smiles(component)
            if smiles:
                reactants.append(smiles)
    products = []
    for outcome in reaction.outcomes:
        for product in outcome.products:
            smiles = _product_smiles(product)
            if smiles:
                products.append(smiles)
    reactants = _unique_preserve_order(reactants)
    products = _unique_preserve_order(products)
    if not reactants or not products:
        return ""
    return ".".join(reactants) + ">>" + ".".join(products)


def _component_smiles(component: Any) -> str:
    for identifier in component.identifiers:
        if _identifier_type_name(identifier) in {"SMILES", "CXSMILES"}:
            return str(identifier.value).strip()
    return ""


def _product_smiles(product: Any) -> str:
    for identifier in product.identifiers:
        if _identifier_type_name(identifier) in {"SMILES", "CXSMILES"}:
            return str(identifier.value).strip()
    return ""


def _identifier_type_name(identifier: Any) -> str:
    return identifier.DESCRIPTOR.fields_by_name["type"].enum_type.values_by_number[identifier.type].name


def _mapped_rxn_from_response_item(item: Any) -> str | None:
    if not item:
        return None
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        value = item.get("mapped_rxn") or item.get("mapped_rxn_smiles")
        return str(value) if value else None
    value = getattr(item, "mapped_rxn", None)
    return str(value) if value else None


def _has_atom_mapping(rxn_smiles: str) -> bool:
    return bool(rxn_smiles and ":" in rxn_smiles and "[" in rxn_smiles and "]" in rxn_smiles)


def _extract_template_row(
    *,
    extract_from_reaction: Any,
    reaction_id: str,
    dataset_name: str,
    source_path: str,
    rxn_smiles: str,
    mapped_rxn_smiles: str,
) -> OrdReactionRow:
    try:
        reactants, products = mapped_rxn_smiles.split(">>", 1)
        template = extract_from_reaction(
            {
                "_id": reaction_id,
                "reactants": reactants,
                "products": products,
            }
        )
        template_smarts = f"{template['products']}>>{template['reactants']}"
        if not template_smarts.strip() or template_smarts == ">>":
            raise ValueError("empty_template_smarts")
    except Exception as exc:
        return OrdReactionRow(
            reaction_id=reaction_id,
            dataset_name=dataset_name,
            source_path=source_path,
            rxn_smiles=rxn_smiles,
            mapped_rxn_smiles=mapped_rxn_smiles,
            status="rejected",
            reason=f"template_extraction_failed:{type(exc).__name__}",
            template_smarts="",
        )
    return OrdReactionRow(
        reaction_id=reaction_id,
        dataset_name=dataset_name,
        source_path=source_path,
        rxn_smiles=rxn_smiles,
        mapped_rxn_smiles=mapped_rxn_smiles,
        status="accepted",
        reason="",
        template_smarts=template_smarts,
    )


def _merge_template(templates: dict[str, dict[str, Any]], row: OrdReactionRow) -> None:
    if row.status != "accepted" or not row.template_smarts:
        return
    entry = templates.get(row.template_smarts)
    if entry is None:
        entry = {
            "index": -1,
            "reaction_smarts": row.template_smarts,
            "count": 0,
            "necessary_reagent": "",
            "intra_only": False,
            "dimer_only": False,
            "template_set": "ord_extracted",
            "references": [],
            "attributes": {
                "source": "Open Reaction Database",
                "source_format": "ord_schema_pb_gz",
                "ring_delta": 0,
                "chiral_delta": 0,
            },
            "_id": _short_hash(row.template_smarts),
        }
        templates[row.template_smarts] = entry
    entry["count"] += 1
    if len(entry["references"]) < 100:
        entry["references"].append(row.reaction_id)


def _write_audit_row(writer: csv.DictWriter, row: OrdReactionRow) -> None:
    writer.writerow(
        {
            "reaction_id": row.reaction_id,
            "dataset_name": row.dataset_name,
            "source_path": row.source_path,
            "rxn_smiles": row.rxn_smiles,
            "mapped_rxn_smiles": row.mapped_rxn_smiles,
            "status": row.status,
            "reason": row.reason,
            "template_smarts": row.template_smarts,
        }
    )


def _unique_preserve_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            output.append(value)
    return output


def _short_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


if __name__ == "__main__":
    raise SystemExit(main())
