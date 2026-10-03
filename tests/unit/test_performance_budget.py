import pytest

from packages.platform.performance import PerformanceBudget


def test_resource_budgets_are_positive_and_consistent():
    budget = PerformanceBudget()
    assert budget.active_jobs == 1
    assert budget.search_parallelism == 2
    assert budget.model_parallelism == 1
    with pytest.raises(ValueError):
        PerformanceBudget(active_jobs=0)
    with pytest.raises(ValueError):
        PerformanceBudget(stock_batch_size=9999)
    with pytest.raises(ValueError):
        PerformanceBudget(model_parallelism=5)


def test_budget_environment_is_one_authority(monkeypatch):
    monkeypatch.setenv("X_SYNTH_MODEL_THREADS", "2")
    assert PerformanceBudget.from_environment().model_threads == 2
