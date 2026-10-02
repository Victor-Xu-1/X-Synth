from concurrent.futures import ThreadPoolExecutor

import pytest

from packages.orchestrator.job_repository import JobConflict, JobRepository


def test_real_job_database_ownership_idempotency_and_history(tmp_path):
    repo = JobRepository(tmp_path / "jobs.sqlite")
    job = repo.create("alice", {"smiles": "CCO"}, request_key="submission-1")
    assert repo.create("alice", {"smiles": "CCO"}, request_key="submission-1")["id"] == job["id"]
    assert repo.get(job["id"], owner="bob") is None
    assert repo.list("bob") == []
    with pytest.raises(JobConflict):
        repo.create("alice", {"smiles": "CCN"}, request_key="submission-1")
    assert repo.list("alice")[0]["status"] == "queued"
    assert JobRepository(repo.path).get(job["id"])["request"]["smiles"] == "CCO"


def test_concurrent_workers_cannot_admit_more_than_the_budget(tmp_path):
    repo = JobRepository(tmp_path / "jobs.sqlite")
    for _ in range(5):
        repo.create("owner", {"smiles": "CCO"})
    with ThreadPoolExecutor(max_workers=4) as pool:
        claims = list(pool.map(lambda _: repo.claim_next(active_limit=1), range(4)))
    claimed = [item for item in claims if item is not None]
    assert len(claimed) == 1
    assert len(repo.list("owner")) == 5
    assert [event["status"] for event in repo.events(claimed[0]["id"])] == ["queued", "preparing"]


def test_cancelled_job_cannot_be_overwritten_by_late_result(tmp_path):
    repo = JobRepository(tmp_path / "jobs.sqlite")
    created = repo.create("owner", {"smiles": "CCO"})
    repo.transition(created["id"], "cancelled", expected_revision=0)
    with pytest.raises(JobConflict):
        repo.transition(created["id"], "preparing", expected_revision=0)
    assert repo.get(created["id"])["status"] == "cancelled"
    with pytest.raises(JobConflict):
        repo.transition(created["id"], "completed", expected_revision=1)
