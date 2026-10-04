"""Execution safety contracts; no fake chemical prediction outputs."""

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps/askcos-v2/impurity_predictor"))
from native_mapper import configured_model_threads
from native_runtime import ImpurityRuntime
from native_session import PredictionSession
from packages.adapters.askcos.native_models import NativeModelError
from packages.adapters.askcos.impurities import origin_ranking_score


class UnavailableForward:
    def __init__(self):
        self.model, self.filter = SimpleNamespace(timeout=45), SimpleNamespace(timeout=45)
        self.calls = 0

    def predict(self, **kwargs):
        self.calls += 1
        raise NativeModelError("Provider connection failed", 503)


def session():
    forward = UnavailableForward()
    return PredictionSession(None, forward, None), forward


def test_only_atom_only_subsets_skip_with_a_run_log_and_no_provider_call():
    value, forward = session()
    value.mode = 3
    assert value.predict(smiles=["Cl.Cl"], backend="graph2smiles", model_name="uspto_stereo") == [[]]
    assert list(value.skipped.values()) == [{"mode": 3, "reactants": "Cl.Cl", "reason": "atom_only_context_not_supported"}]
    assert not value.predictions
    assert forward.calls == 0


def test_primary_unsupported_input_and_provider_failure_do_not_become_empty_results():
    value, forward = session()
    with pytest.raises(ValueError):
        value.predict(smiles=["Cl"], backend="graph2smiles", model_name="uspto_stereo")
    assert forward.calls == 0
    with pytest.raises(NativeModelError) as failure:
        value.predict(smiles=["CCO"], backend="graph2smiles", model_name="uspto_stereo")
    assert failure.value.status == 503
    assert not value.predictions
    assert not value.skipped


@pytest.mark.parametrize("smiles", ["C*", "*"])
def test_wildcards_are_not_disguised_as_unsupported_atom_only_subsets(smiles):
    value, forward = session()
    value.mode = 5
    with pytest.raises(ValueError):
        value.predict(smiles=[smiles], backend="graph2smiles", model_name="uspto_stereo")
    assert not value.skipped and forward.calls == 0


def test_total_deadline_and_call_budget_are_enforced_before_provider():
    value, forward = session()
    value.deadline = 0
    with pytest.raises(NativeModelError) as failure:
        value.predict(smiles=["CCO"], backend="graph2smiles", model_name="uspto_stereo")
    assert failure.value.status == 504
    value, forward = session()
    value.predictions = {str(index): [] for index in range(48)}
    with pytest.raises(ValueError, match="budget"):
        value.predict(smiles=["CCO"], backend="graph2smiles", model_name="uspto_stereo")
    assert forward.calls == 0


def test_runtime_is_not_ready_without_loaded_models_and_rejects_concurrent_execution():
    runtime = ImpurityRuntime()
    assert not runtime.initialized
    with pytest.raises(NativeModelError):
        runtime.predict(None)
    runtime.process = SimpleNamespace(is_alive=lambda: True)
    runtime.provenance = {"test": "guard only, not scientific state"}
    runtime.guard.acquire()
    with pytest.raises(NativeModelError) as failure:
        runtime.predict(None)
    assert failure.value.status == 429
    runtime.guard.release()


@pytest.mark.parametrize("threads", [1, 2, 4, 5, 16, 32])
def test_cpu_threads_follow_the_operator_performance_budget(monkeypatch, threads):
    monkeypatch.setenv("X_SYNTH_MODEL_THREADS", str(threads))
    assert configured_model_threads() == threads


@pytest.mark.parametrize("threads", ["0", "-1", "33", "bad"])
def test_unsupported_cpu_budgets_do_not_silently_clamp(monkeypatch, threads):
    monkeypatch.setenv("X_SYNTH_MODEL_THREADS", threads)
    with pytest.raises(ValueError):
        configured_model_threads()


def test_cpu_budget_uses_shared_defaults_and_validation(monkeypatch):
    from packages.platform.performance import PerformanceBudget

    monkeypatch.delenv("X_SYNTH_MODEL_THREADS", raising=False)
    assert configured_model_threads() == PerformanceBudget().model_threads
    monkeypatch.setenv("X_SYNTH_ACTIVE_JOBS", "2")
    with pytest.raises(ValueError, match="one active"):
        configured_model_threads()


@pytest.mark.parametrize("filter_score", [0.0, 0.5, 1.0])
def test_joint_ranking_arithmetic_uses_the_declared_ff_floor_not_success_probability(filter_score):
    import math

    score = origin_ranking_score(SimpleNamespace(log_probability=-2.0, feasibility_score=filter_score))
    assert math.isfinite(score)
    assert score == pytest.approx(-2.0 + math.log(max(filter_score, 1e-30)))
