"""Accepted submission receipts remain replayable during a dependency outage."""

import pytest

from packages.orchestrator.job_commands import RouteDependenciesUnavailable, RouteJobCommands
from packages.orchestrator.job_repository import JobConflict, JobRepository
from packages.platform.performance import PerformanceBudget


def test_existing_receipt_is_returned_without_probing_or_creating_a_second_job(tmp_path):
    repository = JobRepository(tmp_path / "jobs.sqlite")
    body = {"smiles": "CCO", "strategies": ["mcts"]}
    job = repository.create("owner", body, request_key="receipt")
    commands = RouteJobCommands(repository=repository, budget=PerformanceBudget(),
        readiness=lambda: (_ for _ in ()).throw(AssertionError("Replay must not probe models")))
    assert commands.submit("owner", body, request_key="receipt")["id"] == job["id"]
    assert repository.count("owner") == 1
    with pytest.raises(JobConflict):
        commands.submit("owner", {**body, "smiles": "CCN"}, request_key="receipt")


def test_new_task_does_not_start_without_readiness_and_receipts_are_owner_scoped(tmp_path):
    repository = JobRepository(tmp_path / "jobs.sqlite")
    body = {"smiles": "CCO", "strategies": ["mcts"]}
    repository.create("alice", body, request_key="receipt")
    commands = RouteJobCommands(repository=repository, budget=PerformanceBudget(),
        readiness=lambda: {"route_search_ready": False, "available_strategies": []})
    with pytest.raises(RouteDependenciesUnavailable):
        commands.submit("bob", body, request_key="receipt")
    assert repository.count("bob") == 0
    with pytest.raises(ValueError):
        commands.submit("alice", body, request_key="")


def test_cancellation_is_idempotent_and_cannot_change_another_owner_task(tmp_path):
    repository = JobRepository(tmp_path / "jobs.sqlite")
    job = repository.create("alice", {"smiles": "CCO"})
    commands = RouteJobCommands(repository=repository, budget=PerformanceBudget(), readiness=None)
    with pytest.raises(KeyError):
        commands.cancel(job["id"], "bob")
    first = commands.cancel(job["id"], "alice")
    assert first["status"] == "cancelled"
    assert commands.cancel(job["id"], "alice")["revision"] == first["revision"]
