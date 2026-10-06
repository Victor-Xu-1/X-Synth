"""The managed gateway cannot time out a request inside its admitted queue wait."""

import importlib.util
import sys
from pathlib import Path

import pytest

from packages.adapters.askcos.native_service_limits import NativeExecutionSlot
from packages.platform.performance import PerformanceBudget
from packages.adapters.askcos.native_models import NativeModelClient, NativeModelError

ROOT = Path(__file__).resolve().parents[2]


def test_model_budget_rejects_inverted_timeout_contracts():
    with pytest.raises(ValueError, match="queue wait"):
        PerformanceBudget(model_timeout_seconds=10)
    with pytest.raises(ValueError, match="postprocessing"):
        PerformanceBudget(expansion_timeout_seconds=360)


def test_product_forward_client_shares_budget_and_does_not_retry_protocol_errors(monkeypatch):
    monkeypatch.setenv("X_SYNTH_MODEL_TIMEOUT_SECONDS", "200")
    assert NativeModelClient("http://127.0.0.1:9911").timeout == 200
    assert NativeModelError("invalid", 422).recoverable is False
    assert NativeModelError("timeout", 503).recoverable is True
    assert NativeModelError("protocol", 502, recoverable=False).recoverable is False
    for invalid in (0, -1, float("inf"), float("nan")):
        with pytest.raises(ValueError):
            NativeModelClient("http://127.0.0.1:9911", timeout=invalid)


def test_managed_gateway_uses_the_same_operator_timeout_budget(monkeypatch):
    monkeypatch.setenv("X_SYNTH_NATIVE_QUEUE_WAIT_SECONDS", "150")
    monkeypatch.setenv("X_SYNTH_MODEL_TIMEOUT_SECONDS", "240")
    monkeypatch.setenv("X_SYNTH_EXPANSION_TIMEOUT_SECONDS", "720")
    monkeypatch.syspath_prepend(str(ROOT / "apps/askcos-v2/askcos2_core"))
    file = ROOT / "apps/askcos-v2/askcos2_core/configs/module_config_x_synth.py"
    spec = importlib.util.spec_from_file_location("timeout_contract_config", file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    config = module.module_config
    assert config["retro_template_relevance"]["deployment"]["timeout"] == 240
    assert config["fast_filter"]["deployment"]["timeout"] == 240
    assert config["tree_search_expand_one"]["deployment"]["timeout"] == 720
    assert NativeExecutionSlot().wait_seconds == 150
    # The preserved upstream configuration is not rewritten by this product overlay.
    assert sys.modules["configs.module_config_full"].module_config["retro_template_relevance"]["deployment"]["timeout"] == 10
