from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_STOCK_CONFIG = REPO_ROOT / "data" / "compiled" / "unified_stock" / "aizynthfinder_stock_config.yml"
_ASSET_SUFFIXES = (".onnx", ".csv.gz", ".hdf5", ".hd5", ".h5", ".yml", ".yaml")
_ASSET_SECTIONS = ("expansion", "filter", "stock")


def prepare_config_for_stock(
    config_path: Path,
    *,
    stock: str,
    output_dir: Path,
    stock_config_path: Path | None = None,
    search_overrides: dict[str, Any] | None = None,
) -> Path:
    """Return an AiZynthFinder config that contains the requested stock key."""

    original_config = _read_yaml(config_path)
    base_config = dict(original_config)
    for section in _ASSET_SECTIONS:
        if section in base_config:
            base_config[section] = _normalize_asset_paths(base_config[section], config_path.resolve().parent)
    if stock in dict(base_config.get("stock") or {}) and not search_overrides and base_config == original_config:
        return config_path

    merged = dict(base_config)
    merged_stock = dict(merged.get("stock") or {})
    if stock not in merged_stock:
        stock_config = stock_config_path or _default_stock_config_path()
        if not stock_config.is_file():
            raise FileNotFoundError(
                f"AiZynthFinder stock '{stock}' is not present in {config_path}, "
                f"and stock config was not found: {stock_config}"
            )

        stock_payload = _read_yaml(stock_config)
        stock_entries = dict(stock_payload.get("stock") or {})
        if stock not in stock_entries:
            available = ", ".join(sorted(stock_entries)) or "<none>"
            raise KeyError(f"AiZynthFinder stock '{stock}' not found in {stock_config}; available: {available}")
        merged_stock[stock] = _normalize_asset_paths(stock_entries[stock], stock_config.resolve().parent)
    merged["stock"] = merged_stock
    if search_overrides:
        merged_search = dict(merged.get("search") or {})
        merged_search.update(search_overrides)
        merged["search"] = merged_search

    output_dir.mkdir(parents=True, exist_ok=True)
    merged_path = output_dir / f"{config_path.stem}.{stock}.merged.yml"
    merged_path.write_text(yaml.safe_dump(merged, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return merged_path


def _default_stock_config_path() -> Path:
    configured = os.environ.get("SYNON_AIZYNTH_STOCK_CONFIG")
    if configured:
        return Path(configured)
    return DEFAULT_STOCK_CONFIG


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"AiZynthFinder config not found: {path}")
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"AiZynthFinder config must contain a YAML mapping: {path}")
    return payload


def _normalize_asset_paths(value: Any, base_dir: Path, *, path_field: bool = False) -> Any:
    if isinstance(value, dict):
        return {
            key: _normalize_asset_paths(item, base_dir, path_field=key == "path")
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_normalize_asset_paths(item, base_dir) for item in value]
    if isinstance(value, str) and (path_field or value.endswith(_ASSET_SUFFIXES)):
        path = Path(value)
        return str(path if path.is_absolute() else (base_dir / path).resolve())
    return value


def referenced_asset_paths(config_path: Path) -> list[Path]:
    """Use the same YAML/path rules as the effective engine configuration."""
    payload = _read_yaml(config_path)
    assets = []
    for section in _ASSET_SECTIONS:
        entry = _normalize_asset_paths(payload.get(section, {}), config_path.resolve().parent)
        assets.extend(_collect_asset_paths(entry))
    return assets


def _collect_asset_paths(value: Any, *, path_field: bool = False) -> list[Path]:
    if isinstance(value, dict):
        return [path for key, item in value.items() for path in _collect_asset_paths(item, path_field=key == "path")]
    if isinstance(value, list):
        return [path for item in value for path in _collect_asset_paths(item)]
    if isinstance(value, str) and (path_field or value.endswith(_ASSET_SUFFIXES)):
        return [Path(value)]
    return []
