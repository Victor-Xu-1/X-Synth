from pathlib import Path
import subprocess
import sys

import pytest

from packages.platform.native_runtime import read_private_environment


def test_platform_startup_exposes_only_explicit_asset_and_state_configuration():
    result = subprocess.run([sys.executable, "-m", "scripts.operations.serve_platform", "--help"],
                            capture_output=True, text=True, check=True)
    for option in ("--credentials", "--native-python", "--assets", "--state", "--stock-index"):
        assert option in result.stdout


def test_startup_has_no_smoke_stock_auto_import_or_global_process_killing():
    text = Path("packages/platform/native_runtime.py").read_text()
    assert "tests/real-cases" not in text
    assert "pgrep" not in text
    assert "pkill" not in text
    assert "input_sha256" not in text
    assert "self.restarts[name] >= 3" in text


def test_private_runtime_configuration_requires_owner_only_permissions(tmp_path):
    path = tmp_path / "runtime.env"
    path.write_text("MONGO_PORT=27018\n", encoding="utf-8")
    path.chmod(0o644)
    with pytest.raises(ValueError, match="owner-only"):
        read_private_environment(path)
    path.chmod(0o600)
    assert read_private_environment(path)["MONGO_PORT"] == "27018"


def test_tree_search_controller_worker_runs_single_heavy_task_for_stability():
    text = Path("apps/askcos-v2/askcos2_core/scripts/start_celery_workers.sh").read_text()
    assert "start_worker 1 tree_search_worker" in text
