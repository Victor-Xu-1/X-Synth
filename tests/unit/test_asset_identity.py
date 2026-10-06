from packages.platform.asset_identity import content_digest

import hashlib
import os
from types import SimpleNamespace

import pytest

from packages.platform import asset_identity


def test_asset_identity_changes_with_real_content(tmp_path):
    path = tmp_path / "model.asset"
    path.write_bytes(b"first asset")
    first = content_digest(path)
    assert content_digest(path) == first
    path.write_bytes(b"different asset")
    assert content_digest(path) != first


def test_same_size_mtime_replacement_invalidates_digest_cache(tmp_path):
    path, replacement = tmp_path / "asset.bin", tmp_path / "replacement.bin"
    path.write_bytes(b"first")
    before = path.stat()
    first = content_digest(path)
    replacement.write_bytes(b"other")
    os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
    replacement.replace(path)
    assert content_digest(path) != first


def test_asset_change_during_hashing_is_rejected(tmp_path, monkeypatch):
    path = tmp_path / "asset.bin"
    path.write_bytes(b"original")
    original = hashlib.file_digest

    def changed(handle, algorithm):
        result = original(handle, algorithm)
        path.write_bytes(b"modified")
        return result

    monkeypatch.setattr(asset_identity.hashlib, "file_digest", changed)
    with pytest.raises(ValueError, match="changed"):
        content_digest(path)


@pytest.mark.parametrize("directory", [
    "fast_filter", "pathway_ranker", "value_network", "scscore",
    "packages/adapters/askcos/catalog_pricer.py",
    "packages/adapters/stock/stock_index.py",
    "packages/adapters/stock/commercial_stock.py",
    "packages/adapters/stock/supplier_evidence.py",
    "packages/adapters/stock/stock_snapshot.py",
    "packages/adapters/stock/catalog_pricing.py",
    "packages/platform/immutable_sqlite.py",
    "packages/adapters/askcos/native_http.py",
    "packages/adapters/askcos/native_search_jobs.py",
    "packages/adapters/askcos/native_search_protocol.py",
    "packages/adapters/askcos/native_service_limits.py",
    "packages/platform/native_search_contract.py",
])
def test_supporting_algorithm_source_changes_identity_without_rehashing_weights(tmp_path, monkeypatch, directory):
    """Tiny file identity controls; no model inference or provider is simulated."""
    source, assets = tmp_path / "source", tmp_path / "assets"
    for name in asset_identity.NATIVE_EXTERNAL_FILES:
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("CONTROL = 1\n", encoding="ascii")
    changed_source = (
        source / directory if directory.startswith("packages/")
        else source / "apps/askcos-v2" / directory / "algorithm.py"
    )
    changed_source.parent.mkdir(parents=True, exist_ok=True)
    changed_source.write_text("CONTROL = 1\n", encoding="ascii")
    for name in (
        "models/fast_filter/1/saved_model.pb",
        "models/fast_filter/1/variables/variables.data",
        "models/pathway_ranker/treeLSTM512-fp2048.pt",
        "models/value_network/epoch_99.pt",
        "models/scscore/model_1024bool.npz",
    ):
        path = assets / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"non-model-file-identity-control")
    hashes, original = [], hashlib.file_digest

    def measured(handle, algorithm):
        hashes.append(handle.name)
        return original(handle, algorithm)

    monkeypatch.setattr(asset_identity.hashlib, "file_digest", measured)
    stock = SimpleNamespace(summary={"catalog_sha256": "a" * 64})
    first = asset_identity.native_asset_identity(source, assets, stock, [])
    count = len(hashes)
    changed_source.write_text("CONTROL = 2\n", encoding="ascii")
    assert asset_identity.native_asset_identity(source, assets, stock, []) != first
    assert len(hashes) == count


def test_each_stock_decision_helper_is_in_identity_boundary():
    assert {
        "packages/adapters/askcos/catalog_pricer.py",
        "packages/adapters/stock/stock_index.py",
        "packages/adapters/stock/commercial_stock.py",
        "packages/adapters/stock/supplier_evidence.py",
        "packages/adapters/stock/stock_snapshot.py",
        "packages/adapters/stock/catalog_pricing.py",
        "packages/platform/immutable_sqlite.py",
    } <= set(asset_identity.NATIVE_EXTERNAL_FILES)
