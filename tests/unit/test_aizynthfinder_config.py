from pathlib import Path

import yaml

from packages.adapters.aizynthfinder.config import DEFAULT_STOCK_CONFIG, prepare_config_for_stock


def test_default_aizynthfinder_stock_config_is_the_unified_commercial_index():
    assert DEFAULT_STOCK_CONFIG.parts[-2:] == (
        "unified_stock",
        "aizynthfinder_stock_config.yml",
    )


def test_prepare_config_for_stock_merges_domestic_stock_when_missing(tmp_path):
    base_config = tmp_path / "config.yml"
    base_config.write_text(
        "\n".join(
            [
                "expansion:",
                "  uspto:",
                "    - model.onnx",
                "    - templates.csv.gz",
                "stock:",
                "  zinc: zinc_stock.hdf5",
            ]
        ),
        encoding="utf-8",
    )
    stock_file = tmp_path / "domestic_inchikeys.txt"
    stock_file.write_text("QTBSBXVTEAMEQO-UHFFFAOYSA-N\n", encoding="utf-8")
    stock_config = tmp_path / "aizynthfinder_stock_config.yml"
    stock_config.write_text(
        "\n".join(
            [
                "stock:",
                "  domestic:",
                "    type: inchiset",
                f"    path: {stock_file}",
            ]
        ),
        encoding="utf-8",
    )

    merged = prepare_config_for_stock(
        base_config,
        stock="domestic",
        output_dir=tmp_path / "run",
        stock_config_path=stock_config,
    )

    payload = yaml.safe_load(merged.read_text(encoding="utf-8"))
    assert payload["stock"]["zinc"] == str(tmp_path / "zinc_stock.hdf5")
    assert payload["expansion"]["uspto"] == [
        str(tmp_path / "model.onnx"), str(tmp_path / "templates.csv.gz")
    ]
    assert payload["stock"]["domestic"]["type"] == "inchiset"
    assert payload["stock"]["domestic"]["path"] == str(stock_file)


def test_prepare_config_for_stock_uses_original_config_when_stock_exists(tmp_path):
    base_config = tmp_path / "config.yml"
    base_config.write_text(f"stock:\n  zinc: {tmp_path / 'zinc_stock.hdf5'}\n", encoding="utf-8")

    assert prepare_config_for_stock(base_config, stock="zinc", output_dir=tmp_path / "run") == base_config


def test_relative_assets_are_resolved_before_config_is_moved(tmp_path, monkeypatch):
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    base_config = model_dir / "config.yml"
    base_config.write_text(
        "expansion:\n  uspto: [model.onnx, templates.csv.gz]\n"
        "filter:\n  uspto: filter.onnx\nstock:\n  zinc: stock.hdf5\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    effective = prepare_config_for_stock(
        base_config, stock="zinc", output_dir=tmp_path / "run",
        search_overrides={"iteration_limit": 2},
    )
    payload = yaml.safe_load(effective.read_text(encoding="utf-8"))
    assert payload["expansion"]["uspto"] == [
        str(model_dir / "model.onnx"), str(model_dir / "templates.csv.gz")
    ]
    assert payload["filter"]["uspto"] == str(model_dir / "filter.onnx")
    assert payload["stock"]["zinc"] == str(model_dir / "stock.hdf5")


def test_additional_stock_paths_are_relative_to_stock_config(tmp_path):
    base_config = tmp_path / "config.yml"
    base_config.write_text("stock: {}\n", encoding="utf-8")
    stock_dir = tmp_path / "stock"
    stock_dir.mkdir()
    stock_config = stock_dir / "config.yml"
    stock_config.write_text("stock:\n  unified:\n    type: inchiset\n    path: index.txt\n", encoding="utf-8")
    effective = prepare_config_for_stock(
        base_config, stock="unified", output_dir=tmp_path / "run", stock_config_path=stock_config,
    )
    payload = yaml.safe_load(effective.read_text(encoding="utf-8"))
    assert payload["stock"]["unified"]["path"] == str(stock_dir / "index.txt")
