"""Transport failure fixtures are not Bayesian recommendations or measured experiments."""

import subprocess

import pytest
from test_optimization_tables import request_body

from packages.adapters.optimization.contracts import (
    NextExperiment,
    OptimizationRequest,
    OptimizationResult,
)
from packages.adapters.optimization.prepare import prepare_experiment
from packages.adapters.optimization.runtime import (
    OptimizationError,
    OptimizationRuntime,
)
from packages.adapters.optimization.tables import export_recommendations


def transport_fixture(request):
    prepared = prepare_experiment(request)
    rows = [
        NextExperiment(
            conditions={"temperature": 20, "solvent": "b"},
            posterior_mean=0,
            posterior_std=1,
        )
    ]
    return OptimizationResult(
        request_sha256=prepared.request_sha256,
        table_sha256=request.table_sha256,
        versions={"baybe": "0.15.0"},
        seed=request.seed,
        selected_rows=request.selected_rows,
        measurement_count=3,
        unique_measured_conditions=3,
        candidate_count=6,
        remaining_before_batch=3,
        best_observed=3,
        target=request.target,
        recommendations=rows,
        warnings=["Protocol test fixture; not a scientific result."],
        csv_content=export_recommendations(
            ["temperature", "solvent"], "response", rows, prepared.request_sha256
        ),
    ).model_dump()


def test_unconfigured_runtime_reports_unavailable_without_loading_product_dependencies(
    monkeypatch,
):
    monkeypatch.delenv("X_SYNTH_OPTIMIZATION_PYTHON", raising=False)
    runtime = OptimizationRuntime()
    assert runtime.health().ready is False
    with pytest.raises(OptimizationError, match="未配置"):
        runtime.recommend(OptimizationRequest.model_validate(request_body()))


def test_runtime_rechecks_typed_result_and_releases_admission_after_failure(
    monkeypatch,
):
    request = OptimizationRequest.model_validate(request_body())
    runtime = OptimizationRuntime()
    payload = transport_fixture(request)
    monkeypatch.setattr(runtime, "_invoke", lambda *args, **kwargs: payload)
    assert runtime.recommend(request).empirically_confirmed is False
    payload["recommendations"][0]["conditions"] = {"temperature": 10, "solvent": "a"}
    for _ in range(2):
        with pytest.raises(OptimizationError, match="已测") as caught:
            runtime.recommend(request)
        assert caught.value.status == 502


@pytest.mark.parametrize(
    "field,value",
    [
        ("table_sha256", "b" * 64),
        ("request_sha256", "b" * 64),
        ("best_observed", 999),
        ("csv_content", "not the computed table"),
        ("versions", {"baybe": "0.12.2"}),
        ("empirically_confirmed", True),
        ("measurement_count", 4),
        ("selected_rows", [1, 2, 4]),
    ],
)
def test_mismatched_or_scientifically_overstated_result_is_rejected(
    monkeypatch, field, value
):
    request = OptimizationRequest.model_validate(request_body())
    runtime = OptimizationRuntime()
    payload = {**transport_fixture(request), field: value}
    monkeypatch.setattr(runtime, "_invoke", lambda *args, **kwargs: payload)
    with pytest.raises(OptimizationError) as caught:
        runtime.recommend(request)
    assert caught.value.status == 502


def test_no_wait_queue_or_unbounded_retry_when_another_computation_is_running():
    runtime = OptimizationRuntime()
    runtime._admission.acquire()
    try:
        with pytest.raises(OptimizationError) as caught:
            runtime.recommend(OptimizationRequest.model_validate(request_body()))
        assert caught.value.status == 429
    finally:
        runtime._admission.release()


def test_worker_command_is_fixed_and_does_not_inherit_secrets_or_model_paths(
    tmp_path, monkeypatch
):
    python = tmp_path / "python"
    python.touch()
    captured = {}
    monkeypatch.setenv("PRIVATE_TOKEN", "must-not-inherit")
    monkeypatch.setenv("PYTHONPATH", "/untrusted")

    def execute(command, **kwargs):
        captured.update(command=command, **kwargs)
        return subprocess.CompletedProcess(command, 0, '{"ready":false}', "")

    monkeypatch.setattr("packages.adapters.optimization.runtime.run_worker", execute)
    OptimizationRuntime(python=python, model_threads=2)._invoke(health=True)
    assert captured["command"][-4:] == [
        "-s",
        "-m",
        "packages.adapters.optimization.worker",
        "--health",
    ]
    assert "shell" not in captured
    assert "PRIVATE_TOKEN" not in captured["env"]
    assert captured["env"]["PYTHONPATH"] != "/untrusted"
    assert captured["timeout"] == 20
    for name in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        assert captured["env"][name] == "2"


def test_thread_budget_is_controller_owned_environment_or_explicit_override(
    monkeypatch,
):
    monkeypatch.setenv("X_SYNTH_MODEL_THREADS", "3")
    assert OptimizationRuntime().model_threads == 3
    assert OptimizationRuntime(model_threads=2).model_threads == 2


@pytest.mark.parametrize("value", [True, 0, 33, "4"])
def test_invalid_model_thread_budget_is_not_silently_coerced(value):
    with pytest.raises(ValueError):
        OptimizationRuntime(model_threads=value)


def test_timeout_has_no_result_fallback_and_no_untrusted_error_details(
    tmp_path, monkeypatch
):
    python = tmp_path / "python"
    python.touch()

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], 1, output="private data")

    monkeypatch.setattr("packages.adapters.optimization.runtime.run_worker", timeout)
    with pytest.raises(OptimizationError) as caught:
        OptimizationRuntime(python=python)._invoke()
    assert caught.value.status == 504
    assert "private data" not in str(caught.value)


def test_health_probe_does_not_spawn_a_competing_worker_and_cache_does_not_repeat_imports(
    monkeypatch,
):
    runtime = OptimizationRuntime()
    calls = []
    monkeypatch.setattr(
        runtime,
        "_invoke",
        lambda **kwargs: (
            calls.append(kwargs)
            or {
                "ready": True,
                "reason": "Protocol test",
                "versions": {"baybe": "0.15.0"},
            }
        ),
    )
    runtime._admission.acquire()
    assert runtime.health().ready is False
    assert not calls
    runtime._admission.release()
    assert runtime.health().ready is True
    assert runtime.health().ready is True
    assert len(calls) == 1


def test_verified_ready_remains_visible_during_busy_compute_and_cache_is_60_seconds(
    monkeypatch,
):
    runtime = OptimizationRuntime()
    calls = []
    now = [100.0]
    monkeypatch.setattr(
        "packages.adapters.optimization.runtime.time.monotonic", lambda: now[0]
    )
    monkeypatch.setattr(
        runtime,
        "_invoke",
        lambda **kwargs: (
            calls.append(kwargs)
            or {
                "ready": True,
                "reason": "Verified test probe",
                "versions": {"baybe": "0.15.0"},
            }
        ),
    )
    assert runtime.health().ready is True
    now[0] = 159.0
    assert runtime.health().ready is True and len(calls) == 1
    now[0] = 161.0
    runtime._admission.acquire()
    runtime._computing.set()
    status = runtime.health()
    assert status.ready is True and status.busy is True and len(calls) == 1
    runtime._computing.clear()
    runtime._admission.release()
    assert runtime.health().ready is True and len(calls) == 2


def test_health_snapshot_is_typed_deep_copied_and_never_starts_a_probe(monkeypatch):
    runtime = OptimizationRuntime()
    calls = []
    monkeypatch.setattr(
        runtime,
        "_invoke",
        lambda **kwargs: (
            calls.append(kwargs)
            or {
                "ready": True,
                "reason": "Verified test probe",
                "versions": {"baybe": "0.15.0"},
            }
        ),
    )
    initial = runtime.health_snapshot()
    assert initial.ready is False and initial.reason == "not_probed" and not calls
    assert runtime.health().ready is True
    snapshot = runtime.health_snapshot()
    snapshot.versions["baybe"] = "mutated-by-caller"
    assert runtime.health_snapshot().versions["baybe"] == "0.15.0"
    assert len(calls) == 1
