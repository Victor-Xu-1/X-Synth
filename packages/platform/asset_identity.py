"""Content identities for immutable, operator-installed runtime assets."""

import hashlib
import json
from functools import lru_cache
from pathlib import Path

NATIVE_EXTERNAL_FILES = (
    "packages/adapters/askcos/route_reachability.py",
    "packages/adapters/askcos/route_enumeration.py",
    "packages/adapters/askcos/retro_star_values.py",
    "packages/chemistry/material_scope.py",
)


@lru_cache(maxsize=32)
def _digest(path: str, size: int, modified: int) -> str:
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def content_digest(path: Path) -> str:
    metadata = path.stat()
    if not path.is_file() or metadata.st_size == 0:
        raise ValueError("Runtime assets must be nonempty regular files")
    return _digest(str(path.resolve()), metadata.st_size, metadata.st_mtime_ns)


def native_asset_identity(source: Path, assets: Path, stock, models: list[str]) -> str:
    installed = {}
    for name in models:
        directory = assets / "models/template-relevance" / name
        manifest = json.loads((directory / "asset.json").read_text())
        for filename, expected in manifest["files"].items():
            if (
                Path(filename).name != filename
                or content_digest(directory / filename) != expected
            ):
                raise ValueError("Native model asset checksum mismatch")
        installed[name] = manifest["files"]
    other = [
        "models/fast_filter/1/saved_model.pb",
        "models/pathway_ranker/treeLSTM512-fp2048.pt",
        "models/value_network/epoch_99.pt",
        "models/scscore/model_1024bool.npz",
    ]
    other.extend(
        str(path.relative_to(assets))
        for path in sorted((assets / "models/fast_filter/1/variables").glob("*"))
    )
    installed["supporting_models"] = {
        path: content_digest(assets / path) for path in other
    }
    code = hashlib.sha256()
    for directory in ("askcos2_core", "tree_search", "retro/template_relevance"):
        for path in sorted((source / "apps/askcos-v2" / directory).rglob("*.py")):
            code.update(str(path.relative_to(source)).encode())
            code.update(path.read_bytes())
    for name in NATIVE_EXTERNAL_FILES:
        external = source / name
        code.update(str(external.relative_to(source)).encode())
        code.update(external.read_bytes())
    return hashlib.sha256(
        json.dumps(
            {
                "stock": stock.summary["catalog_sha256"],
                "models": installed,
                "code": code.hexdigest(),
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
