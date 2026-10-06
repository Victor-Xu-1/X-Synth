"""Resume cheap qualification without re-running completed native searches."""

import hashlib
import json
import os
import re
from pathlib import Path

from packages.platform.atomic_file import write_json


def model_epoch(runtime_path: Path, revision: str, forward_url: str, filter_url: str):
    if not runtime_path.is_file():
        return "unmanaged:" + hashlib.sha256(
            f"{revision}:{forward_url}:{filter_url}:{os.getpid()}".encode()
        ).hexdigest()
    services = json.loads(runtime_path.read_text())["services"]
    value = {
        "revision": revision, "forward_url": forward_url, "filter_url": filter_url,
        "services": {name: services[name] for name in ("forward_predictor", "fast_filter")},
    }
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


class VerificationCache:
    def __init__(self, path: Path, owner: str, epoch: str):
        self.path = path
        self.identity = {"version": 1, "owner": owner, "epoch": epoch}
        self.records = {}
        if path.is_file():
            if path.stat().st_size > 4 * 1024**2:
                raise ValueError("Oversized qualification checkpoint")
            value = json.loads(path.read_text())
            if not isinstance(value, dict) or not isinstance(value.get("records"), dict):
                raise ValueError("Invalid qualification checkpoint")
            if value.get("identity") == self.identity and not epoch.startswith("unmanaged:"):
                self.records = value["records"]
                if any(
                    not re.fullmatch(r"[a-f0-9]{64}", key)
                    or not isinstance(identifier, str)
                    or not re.fullmatch(r"[a-f0-9]{32}", identifier)
                    for key, identifier in self.records.items()
                ):
                    raise ValueError("Invalid qualification record binding")

    @staticmethod
    def key(reactants):
        return hashlib.sha256(reactants.encode()).hexdigest()

    def save(self, reactants: str, identifier: str):
        self.records[self.key(reactants)] = identifier
        write_json(self.path, {"identity": self.identity, "records": self.records})
