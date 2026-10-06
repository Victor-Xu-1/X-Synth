from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any, Iterable

from .supplier_evidence import supplier_record


@dataclass(frozen=True)
class UnifiedAiZynthStockArtifacts:
    output_dir: Path
    stock_path: Path
    config_path: Path
    summary_path: Path
    summary: dict[str, Any]


def build_unified_aizynth_stock(
    *,
    source_paths: Iterable[Path | str],
    output_dir: Path | str,
    stock_name: str = "unified",
) -> UnifiedAiZynthStockArtifacts:
    """Compile exact accepted Synon stock records into one AiZynthFinder index."""

    from rdkit import Chem

    sources = [Path(path) for path in source_paths]
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    inchikeys: set[str] = set()
    accepted_input_records = 0
    invalid_smiles_records = 0
    rejected_evidence_records = 0

    for source_path in sources:
        with source_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        records = _records_from_payload(payload, source_path)
        for record in records:
            if str(record.get("decision") or "accepted").lower() != "accepted":
                continue
            smiles = str(record.get("smiles") or "").strip()
            if not smiles:
                continue
            accepted_input_records += 1
            molecule = Chem.MolFromSmiles(smiles)
            if molecule is None:
                invalid_smiles_records += 1
                continue
            if supplier_record(record) is None:
                rejected_evidence_records += 1
                continue
            inchikey = Chem.MolToInchiKey(molecule)
            if inchikey:
                inchikeys.add(inchikey)

    stock_path = output / "aizynthfinder_stock_inchikeys.txt"
    config_path = output / "aizynthfinder_stock_config.yml"
    summary_path = output / "summary.json"
    ordered_keys = sorted(inchikeys)
    stock_path.write_text(
        "\n".join(ordered_keys) + ("\n" if ordered_keys else ""),
        encoding="utf-8",
    )
    config_path.write_text(
        "stock:\n"
        f"  {stock_name}:\n"
        "    type: inchiset\n"
        f"    path: {stock_path}\n",
        encoding="utf-8",
    )
    summary = {
        "accepted_input_records": accepted_input_records,
        "invalid_smiles_records": invalid_smiles_records,
        "rejected_evidence_records": rejected_evidence_records,
        "unique_structures": len(ordered_keys),
        "source_paths": [str(path) for path in sources],
        "stock_name": stock_name,
        "stock_path": str(stock_path),
        "config_path": str(config_path),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return UnifiedAiZynthStockArtifacts(
        output_dir=output,
        stock_path=stock_path,
        config_path=config_path,
        summary_path=summary_path,
        summary=summary,
    )


def _records_from_payload(payload: Any, source_path: Path) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [record for record in payload if isinstance(record, dict)]
    if isinstance(payload, dict):
        for key in ("records", "data", "rows", "items", "result"):
            records = payload.get(key)
            if isinstance(records, list):
                return [record for record in records if isinstance(record, dict)]
    raise ValueError(f"stock source must contain a JSON record list: {source_path}")
