"""Content identities for immutable, operator-installed runtime assets."""

import hashlib
import json
import os
from functools import lru_cache
from pathlib import Path

from .immutable_sqlite import file_identity, stat_identity

NATIVE_CODE_DIRECTORIES = (
    "askcos2_core", "tree_search", "retro/template_relevance",
    "fast_filter", "pathway_ranker", "value_network", "scscore",
)

NATIVE_EXTERNAL_FILES = (
    "packages/adapters/askcos/route_reachability.py",
    "packages/adapters/askcos/route_enumeration.py",
    "packages/adapters/askcos/retro_star_values.py",
    "packages/adapters/askcos/native_http.py",
    "packages/adapters/askcos/native_search_jobs.py",
    "packages/adapters/askcos/native_search_protocol.py",
    "packages/adapters/askcos/native_service_limits.py",
    "packages/platform/native_search_contract.py",
    "packages/platform/native_endpoints.py",
    "packages/platform/performance.py",
    "packages/chemistry/material_scope.py",
    "packages/adapters/askcos/catalog_pricer.py",
    "packages/adapters/stock/stock_index.py",
    "packages/adapters/stock/commercial_stock.py",
    "packages/adapters/stock/supplier_evidence.py",
    "packages/adapters/stock/stock_snapshot.py",
    "packages/adapters/stock/catalog_pricing.py",
    "packages/platform/immutable_sqlite.py",
)


@lru_cache(maxsize=32)
def _digest(path: str, identity: tuple[int, ...]) -> str:
    with Path(path).open("rb") as source:
        if stat_identity(os.fstat(source.fileno())) != identity:
            raise ValueError("Runtime asset changed before hashing")
        result = hashlib.file_digest(source, "sha256").hexdigest()
        if stat_identity(os.fstat(source.fileno())) != identity:
            raise ValueError("Runtime asset changed while hashing")
    if file_identity(Path(path)) != identity:
        raise ValueError("Runtime asset changed while hashing")
    return result


def content_digest(path: Path) -> str:
    path = path.resolve()
    identity = file_identity(path)
    result = _digest(str(path), identity)
    if file_identity(path) != identity:
        raise ValueError("Runtime asset changed while hashing")
    return result


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
    for directory in NATIVE_CODE_DIRECTORIES:
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
