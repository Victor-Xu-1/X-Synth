"""Stream existing immutable catalogs and new catalog records into one snapshot."""

import hashlib
import json
import re
import sqlite3
from itertools import chain

from .stock_index import StockIndex
from .stock_snapshot import compile_stock_index


def snapshot_records(index, *, batch_size=1000):
    """Keyset paging keeps compilation outside short-lived lookup transactions."""
    if type(batch_size) is not int or not 1 <= batch_size <= 5000:
        raise ValueError("Stock export batches must contain 1-5000 records")
    last = None
    while True:
        index.assert_current()
        with index.connect() as connection:
            connection.row_factory = sqlite3.Row
            if last is None:
                rows = connection.execute(
                    "SELECT * FROM evidence ORDER BY smiles,source,catalog_id LIMIT ?", (batch_size,)
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM evidence WHERE (smiles,source,catalog_id)>(?,?,?) "
                    "ORDER BY smiles,source,catalog_id LIMIT ?", (*last, batch_size)
                ).fetchall()
        if not rows:
            break
        for row in rows:
            yield dict(row)
        last = tuple(rows[-1][key] for key in ("smiles", "source", "catalog_id"))
    index.assert_current()


def merge_stock_snapshots(paths, rows, *, additional_sha256, output, source_id):
    indices = [StockIndex(path) for path in paths]
    if not indices:
        raise ValueError("At least one existing stock snapshot is required")
    if not isinstance(additional_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", additional_sha256):
        raise ValueError("An additional source digest is required")
    provenance = [{key: index.summary[key] for key in (
        "source_id", "source_sha256", "catalog_sha256", "accepted_records", "unique_structures",
    )} for index in indices]
    source_digest = hashlib.sha256(json.dumps({
        "base_catalogs": provenance, "additional_source_sha256": additional_sha256,
    }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    result = compile_stock_index(
        chain(*(snapshot_records(index) for index in indices), rows), output=output,
        source_id=source_id, source_sha256=source_digest,
        publication_guard=lambda: [index.assert_current() for index in indices],
    )
    for index in indices:
        index.assert_current()
    return {"snapshot": result, "base_catalogs": provenance,
            "additional_source_sha256": additional_sha256}
