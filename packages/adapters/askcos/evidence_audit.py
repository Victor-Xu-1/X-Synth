"""Private content-addressed receipts survive empty or filtered candidate batches."""

import hashlib
import json
import os
from pathlib import Path
import re

from packages.platform.atomic_file import write_json


def retain_evidence_query(receipt: dict) -> None:
    state = os.environ.get("X_SYNTH_STATE_DIR")
    if not state:
        return  # Unmanaged library callers return their receipt directly.
    snapshot = receipt.get("snapshot")
    if receipt.get("source") != "ORD" or not isinstance(snapshot, str) or not re.fullmatch(r"[a-f0-9]{64}", snapshot):
        raise ValueError("A pinned exact-retrieval receipt is required")
    digest = hashlib.sha256(json.dumps(receipt, sort_keys=True, allow_nan=False).encode()).hexdigest()
    root = Path(state).resolve(strict=True)
    directory = root / "native/evidence-queries" / snapshot
    for parent in (root / "native", root / "native/evidence-queries", directory):
        if parent.is_symlink() or not parent.resolve().is_relative_to(root):
            raise ValueError("Evidence receipts must stay inside owned private state")
        parent.mkdir(mode=0o700, exist_ok=True)
    write_json(directory / (digest + ".json"), {"schema_version": 1, "receipt": receipt})
