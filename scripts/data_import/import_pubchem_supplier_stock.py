#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import time
from typing import Any, Iterable
import urllib.parse
import urllib.request

from packages.adapters.stock.domestic_artifacts import build_domestic_stock_artifacts


DEFAULT_SOURCES: dict[str, dict[str, str]] = {
    "aladdin": {
        "term": "Aladdin[SourceName]",
        "supplier": "Aladdin Scientific",
        "source": "aladdin",
    },
    "ambeed": {
        "term": "Ambeed[SourceName]",
        "supplier": "Ambeed",
        "source": "ambeed",
    },
    "sigma_aldrich": {
        "term": "Sigma-Aldrich[SourceName]",
        "supplier": "Sigma-Aldrich",
        "source": "sigma_aldrich",
    },
    "targetmol": {
        "term": "TargetMol[SourceName]",
        "supplier": "TargetMol",
        "source": "targetmol",
    },
    "chemscene": {
        "term": "ChemScene[SourceName]",
        "supplier": "ChemScene",
        "source": "chemscene",
    },
    "combi_blocks": {
        "term": "Combi-Blocks[SourceName]",
        "supplier": "Combi-Blocks",
        "source": "combi_blocks",
    },
}

ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
PROPERTY_URL = (
    "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/property/"
    "CanonicalSMILES,IsomericSMILES,InChIKey/JSON"
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Import large exact-structure supplier stock from official PubChem "
            "SourceName records and compile it into Synon/ASKCOS/AiZynthFinder stock artifacts."
        )
    )
    parser.add_argument(
        "--source",
        action="append",
        choices=sorted(DEFAULT_SOURCES),
        default=[],
        help="Supplier source to import. Defaults to aladdin and ambeed.",
    )
    parser.add_argument("--output-dir", type=Path, default=Path("data/compiled/domestic_stock"))
    parser.add_argument("--raw-output", type=Path, default=None)
    parser.add_argument(
        "--extra-compile-source",
        action="append",
        type=Path,
        default=[],
        help="Existing raw supplier JSONL/CSV/JSON file to include when compiling the final unified stock.",
    )
    parser.add_argument("--retmax", type=int, default=10000, help="Entrez page size.")
    parser.add_argument("--property-batch-size", type=int, default=1000)
    parser.add_argument("--sleep-sec", type=float, default=0.15)
    parser.add_argument("--max-records-per-source", type=int, default=None)
    parser.add_argument("--timeout-sec", type=float, default=120.0)
    parser.add_argument("--api-key-env", default="NCBI_API_KEY")
    args = parser.parse_args()

    source_names = args.source or ["aladdin", "ambeed"]
    raw_output = args.raw_output or args.output_dir / "pubchem_supplier_stock_raw.jsonl"
    raw_output.parent.mkdir(parents=True, exist_ok=True)

    api_key = os.environ.get(args.api_key_env, "").strip()
    summary: dict[str, Any] = {
        "sources": {},
        "raw_output": str(raw_output),
        "output_dir": str(args.output_dir),
    }

    with raw_output.open("w", encoding="utf-8") as handle:
        for source_name in source_names:
            source = DEFAULT_SOURCES[source_name]
            cids, count = fetch_source_cids(
                term=source["term"],
                retmax=args.retmax,
                timeout_sec=args.timeout_sec,
                api_key=api_key,
                max_records=args.max_records_per_source,
            )
            written = 0
            for properties in batched_compound_properties(
                cids,
                batch_size=args.property_batch_size,
                timeout_sec=args.timeout_sec,
                sleep_sec=args.sleep_sec,
            ):
                for row in properties:
                    record = supplier_stock_record(row, source=source)
                    if record is None:
                        continue
                    handle.write(json.dumps(record, ensure_ascii=False) + "\n")
                    written += 1
            summary["sources"][source_name] = {
                "query": source["term"],
                "pubchem_count": count,
                "cid_count": len(cids),
                "raw_records": written,
            }

    compile_sources = [*args.extra_compile_source, raw_output]
    artifacts = build_domestic_stock_artifacts(
        source_paths=compile_sources,
        output_dir=args.output_dir,
        default_source="pubchem_supplier",
    )
    summary["compiled"] = artifacts.summary
    summary["compile_sources"] = [str(path) for path in compile_sources]
    summary_path = args.output_dir / "pubchem_supplier_import_summary.json"
    summary["summary_path"] = str(summary_path)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def fetch_source_cids(
    *,
    term: str,
    retmax: int,
    timeout_sec: float,
    api_key: str,
    max_records: int | None,
) -> tuple[list[str], int]:
    first = _entrez_esearch(term=term, retstart=0, retmax=0, timeout_sec=timeout_sec, api_key=api_key)
    count = int(first["esearchresult"]["count"])
    target_count = min(count, max_records) if max_records is not None else count
    cids: list[str] = []
    for retstart in range(0, target_count, retmax):
        page_size = min(retmax, target_count - retstart)
        payload = _entrez_esearch(
            term=term,
            retstart=retstart,
            retmax=page_size,
            timeout_sec=timeout_sec,
            api_key=api_key,
        )
        cids.extend(payload["esearchresult"].get("idlist") or [])
    return cids, count


def batched_compound_properties(
    cids: list[str],
    *,
    batch_size: int,
    timeout_sec: float,
    sleep_sec: float,
) -> Iterable[list[dict[str, Any]]]:
    for start in range(0, len(cids), batch_size):
        batch = cids[start : start + batch_size]
        if not batch:
            continue
        payload = _post_pubchem_properties(batch, timeout_sec=timeout_sec)
        yield payload.get("PropertyTable", {}).get("Properties", [])
        if sleep_sec > 0:
            time.sleep(sleep_sec)


def supplier_stock_record(row: dict[str, Any], *, source: dict[str, str]) -> dict[str, Any] | None:
    smiles = str(row.get("SMILES") or row.get("ConnectivitySMILES") or "").strip()
    cid = str(row.get("CID") or "").strip()
    if not smiles or not cid:
        return None
    return {
        "smiles": smiles,
        "source": source["source"],
        "supplier": source["supplier"],
        "cid": cid,
        "catalog_id": None,
        "url": f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}",
        "availability": None,
        "evidence_role": "structure_metadata",
        "inchi_key": str(row.get("InChIKey") or "").strip(),
    }


def _entrez_esearch(
    *,
    term: str,
    retstart: int,
    retmax: int,
    timeout_sec: float,
    api_key: str,
) -> dict[str, Any]:
    params = {
        "db": "pccompound",
        "term": term,
        "retmode": "json",
        "retstart": str(retstart),
        "retmax": str(retmax),
    }
    if api_key:
        params["api_key"] = api_key
    url = ESEARCH_URL + "?" + urllib.parse.urlencode(params)
    return _json_request(url, timeout_sec=timeout_sec)


def _post_pubchem_properties(cids: list[str], *, timeout_sec: float) -> dict[str, Any]:
    body = urllib.parse.urlencode({"cid": ",".join(cids)}).encode()
    request = urllib.request.Request(PROPERTY_URL, data=body, method="POST")
    return _json_request(request, timeout_sec=timeout_sec)


def _json_request(url_or_request: str | urllib.request.Request, *, timeout_sec: float) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url_or_request, timeout=timeout_sec) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - network retry around public APIs.
            last_error = exc
            time.sleep(2**attempt)
    assert last_error is not None
    raise last_error


if __name__ == "__main__":
    raise SystemExit(main())
