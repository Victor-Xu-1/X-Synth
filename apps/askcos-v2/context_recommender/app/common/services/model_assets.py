"""Validate immutable model assets and load only primitive label dictionaries."""

import hashlib
import json
import pickle
from pathlib import Path


class LabelUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        raise pickle.UnpicklingError("Executable objects are not model labels")


def load_labels(path):
    path = Path(path)
    if path.is_symlink() or path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("Invalid label asset")
    with path.open("rb") as handle:
        labels = LabelUnpickler(handle).load()
    if not isinstance(labels, dict) or any(
        type(key) is not int or type(value) is not str or len(value) > 8192
        for key, value in labels.items()
    ):
        raise ValueError("Invalid model label dictionary")
    return labels


def validate_assets(directory):
    directory = Path(directory)
    required = {
        "model.json", "weights.h5", "ehs_solvent_scores.csv",
        "c1_dict.pickle", "r1_dict.pickle", "r2_dict.pickle",
        "s1_dict.pickle", "s2_dict.pickle",
    }
    manifest_path = directory / "asset.json"
    if manifest_path.is_symlink() or manifest_path.stat().st_size > 65536:
        raise ValueError("Invalid model manifest")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1 or set(manifest.get("files", {})) != required:
        raise ValueError("Incomplete condition model snapshot")
    for name, expected in manifest["files"].items():
        path = directory / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("Missing condition model asset")
        with path.open("rb") as handle:
            actual = hashlib.file_digest(handle, "sha256").hexdigest()
        if actual != expected:
            raise ValueError("Condition model asset checksum mismatch")
    for name in required:
        if name.endswith(".pickle"):
            load_labels(directory / name)
    return manifest
