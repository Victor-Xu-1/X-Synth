import subprocess
from pathlib import Path

import yaml


SCRIPT = Path("scripts/data_import/import_askcos_core_data.sh")
BUYABLES_IMPORT_SCRIPT = Path("scripts/data_import/import_askcos_buyables_mongo.sh")
SMILES2ROUTE_MODULE_CONFIG = Path(
    "apps/askcos-v2/askcos2_core/configs/module_config_smiles2route.py"
)


def test_askcos_import_script_supports_template_runtime_asset_overlay():
    text = SCRIPT.read_text(encoding="utf-8")

    assert "SYNON_TEMPLATE_RUNTIME_ASSETS_DIR" in text
    assert "RETRO_TEMPLATE_SEED" in text
    assert "FORWARD_TEMPLATE_SEED" in text
    assert "retro.templates.synon_unified.json.gz" in text
    assert "${TEMPLATE_ROOT}/retro.templates.reaxys.json.gz" in text
    assert "${TEMPLATE_ROOT}/forward.templates.json.gz" in text


def test_askcos_import_script_shell_syntax_is_valid():
    subprocess.run(["bash", "-n", str(SCRIPT)], check=True)


def test_askcos_buyables_import_script_is_idempotent_and_indexed():
    text = BUYABLES_IMPORT_SCRIPT.read_text(encoding="utf-8")

    assert "--mode \"$mode\"" in text
    assert "--upsertFields \"$upsert_fields\"" in text
    assert "smiles,source" in text
    assert "createIndex({smiles: 1, source: 1})" in text
    assert "createIndex({source: 1})" in text
    assert "command -v mongoimport" in text


def test_askcos_buyables_import_script_shell_syntax_is_valid():
    subprocess.run(["bash", "-n", str(BUYABLES_IMPORT_SCRIPT)], check=True)


def test_smiles2route_retrostar_uses_running_route_tree_port():
    text = SMILES2ROUTE_MODULE_CONFIG.read_text(encoding="utf-8")
    compose = yaml.safe_load(Path("apps/askcos-v2/askcos2_core/compose.yaml").read_text())
    service = compose["services"]["retro_star"]
    assert service["build"]["context"] == "../tree_search/retro_star"
    assert "http://127.0.0.1:9321/docs" in " ".join(service["healthcheck"]["test"])
    assert "http://127.0.0.1:9321/get_buyable_paths" in text
    assert "http://127.0.0.1:9311/get_buyable_paths" not in text
    assert "http://mcts:9321/get_buyable_paths" not in text
