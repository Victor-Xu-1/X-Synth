from pathlib import Path

import pytest

from packages.adapters.aizynthfinder.client import AiZynthFinderAdapter


def test_aizynthfinder_adapter_builds_command_args():
    adapter = AiZynthFinderAdapter(
        executable="python",
        config_path=Path("engines/aizynthfinder/models/config.yml"),
    )

    args = adapter.build_command("CCO", output_path=Path("out.json"))

    assert args[:3] == ["python", "-m", "packages.adapters.aizynthfinder.runner"]
    assert "--config" in args
    assert "engines/aizynthfinder/models/config.yml" in args
    assert "CCO" in args
    assert "ringbreaker" in args


def test_aizynthfinder_adapter_builds_command_with_domestic_stock():
    adapter = AiZynthFinderAdapter(
        executable="python",
        config_path=Path("engines/aizynthfinder/models/config.yml"),
    )

    args = adapter.build_command("CCO", output_path=Path("out.json"), stock="domestic")

    stock_index = args.index("--stock")
    assert args[stock_index + 1] == "domestic"


def test_aizynthfinder_adapter_validates_referenced_assets(tmp_path):
    model = tmp_path / "model.onnx"
    templates = tmp_path / "templates.csv.gz"
    stock = tmp_path / "stock.hdf5"
    for path in [model, templates, stock]:
        path.write_text("placeholder", encoding="utf-8")
    config = tmp_path / "config.yml"
    config.write_text(
        "\n".join(
            [
                "expansion:",
                "  uspto:",
                f"    - {model}",
                f"    - {templates}",
                "stock:",
                f"  zinc: {stock}",
            ]
        ),
        encoding="utf-8",
    )

    adapter = AiZynthFinderAdapter(executable="python", config_path=config)

    assert adapter.referenced_assets() == [model, templates, stock]
    adapter.validate_assets()


def test_aizynthfinder_adapter_rejects_missing_model_without_fallback(tmp_path):
    default_config = tmp_path / "config.yml"
    default_config.write_text("stock:\n  zinc: stock.hdf5\n", encoding="utf-8")
    adapter = AiZynthFinderAdapter(executable="python", config_path=default_config)

    with pytest.raises(FileNotFoundError, match="Do not fall back"):
        adapter.config_for_model("Pistachio_100+")


def test_referenced_assets_uses_yaml_structure_and_stock_path(tmp_path):
    config = tmp_path / "config.yml"
    config.write_text(
        "expansion:\n  uspto: [model.onnx, templates.csv.gz]\n"
        "stock:\n  unified: {type: inchiset, path: index.txt}\n",
        encoding="utf-8",
    )
    adapter = AiZynthFinderAdapter(executable="python", config_path=config)
    assert adapter.referenced_assets() == [
        tmp_path / "model.onnx", tmp_path / "templates.csv.gz", tmp_path / "index.txt"
    ]
