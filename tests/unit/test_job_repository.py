import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from packages.orchestrator.job_repository import JobConflict, JobRepository


def test_history_schema_split_preserves_function_and_exception_imports():
    from apps.api.result_routes import JobConflict as ApiConflict
    from packages.orchestrator import job_history, job_history_schema, job_repository

    assert JobConflict is ApiConflict is job_history.JobConflict
    assert (
        job_repository.initialize_schema
        is job_history.initialize_schema
        is job_history_schema.initialize_schema
    )
    assert (
        job_repository.progress_projection
        is job_history.progress_projection
        is job_history_schema.progress_projection
    )
    assert (
        job_repository.TERMINAL_STATES
        is job_history.TERMINAL_STATES
        is job_history_schema.TERMINAL_STATES
    )
    assert job_history.MAX_OFFSET == job_history_schema.MAX_OFFSET


def test_real_job_database_ownership_idempotency_and_history(tmp_path):
    repo = JobRepository(tmp_path / "jobs.sqlite")
    job = repo.create("alice", {"smiles": "CCO"}, request_key="submission-1")
    assert (
        repo.create("alice", {"smiles": "CCO"}, request_key="submission-1")["id"]
        == job["id"]
    )
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
    assert [event["status"] for event in repo.events(claimed[0]["id"])] == [
        "queued",
        "preparing",
    ]


def test_cancelled_job_cannot_be_overwritten_by_late_result(tmp_path):
    repo = JobRepository(tmp_path / "jobs.sqlite")
    created = repo.create("owner", {"smiles": "CCO"})
    repo.transition(created["id"], "cancelled", expected_revision=0)
    with pytest.raises(JobConflict):
        repo.transition(created["id"], "preparing", expected_revision=0)
    assert repo.get(created["id"])["status"] == "cancelled"
    with pytest.raises(JobConflict):
        repo.transition(created["id"], "completed", expected_revision=1)


def schema_one_database(path):
    with sqlite3.connect(path) as connection:
        connection.executescript("""
            CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
            INSERT INTO schema_version VALUES (1);
            CREATE TABLE jobs (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL,
                request TEXT NOT NULL, request_key TEXT, revision INTEGER NOT NULL DEFAULT 0,
                created TEXT NOT NULL, modified TEXT NOT NULL, summary TEXT,
                checkpoint TEXT NOT NULL DEFAULT '{}', error_code TEXT,
                UNIQUE(owner, request_key)
            );
            CREATE TABLE events (
                job_id TEXT NOT NULL REFERENCES jobs(id), revision INTEGER NOT NULL,
                at TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(job_id,revision)
            );
        """)
        for identifier, status, revision in (
            ("historical", "legacy_completed", 0),
            ("archived", "archived", 2),
            ("running", "searching", 2),
        ):
            connection.execute(
                "INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    identifier,
                    "alice",
                    status,
                    json.dumps({"smiles": "CCO", "description": identifier}),
                    None,
                    revision,
                    "2026-01-01",
                    "2026-01-02",
                    '{"selected_route_count": 2}',
                    '{"pass_number": 1, "children": {"mcts": "native"}}',
                    None,
                ),
            )
        connection.executemany(
            "INSERT INTO events VALUES (?,?,?,?)",
            [
                ("historical", 0, "2026-01-01", "legacy_completed"),
                ("archived", 0, "2026-01-01", "queued"),
                ("archived", 1, "2026-01-01", "cancelled"),
                ("archived", 2, "2026-01-02", "archived"),
                ("running", 0, "2026-01-01", "queued"),
                ("running", 1, "2026-01-01", "preparing"),
                ("running", 2, "2026-01-02", "searching"),
            ],
        )


def test_schema_two_upgrade_preserves_old_data_and_recovers_archives(tmp_path):
    path = tmp_path / "jobs.sqlite"
    schema_one_database(path)
    with sqlite3.connect(path) as connection:
        original = connection.execute("SELECT * FROM jobs ORDER BY id").fetchall()
        events = connection.execute(
            "SELECT * FROM events ORDER BY job_id,revision"
        ).fetchall()
        with sqlite3.connect(tmp_path / "backup.sqlite") as backup:
            connection.backup(backup)
    repo = JobRepository(path)
    assert repo.get("archived")["status"] == "cancelled"
    assert repo.get("archived")["archived"] is True
    assert repo.get("running")["checkpoint"]["children"] == {"mcts": "native"}
    assert repo.history_page("alice")["total"] == 2
    with repo.connect() as connection:
        assert [
            row[0] for row in connection.execute("SELECT version FROM schema_version")
        ] == [2]
        migrated = connection.execute(
            "SELECT id,owner,status,request,request_key,revision,created,modified,summary,checkpoint,error_code FROM jobs ORDER BY id"
        ).fetchall()
        assert [
            tuple(row)
            for row in connection.execute(
                "SELECT * FROM events ORDER BY job_id,revision"
            )
        ] == events
    for before, after in zip(original, migrated, strict=True):
        after = tuple(after)
        assert before[:2] == after[:2]
        assert before[3:] == after[3:]
        assert after[2] == ("cancelled" if before[2] == "archived" else before[2])
    reopened = JobRepository(path)
    assert reopened.get("archived") == repo.get("archived")
    with sqlite3.connect(tmp_path / "backup.sqlite") as backup:
        assert backup.execute("SELECT version FROM schema_version").fetchone()[0] == 1
        assert (
            backup.execute("SELECT status FROM jobs WHERE id='archived'").fetchone()[0]
            == "archived"
        )


@pytest.mark.parametrize("versions", [[3], [1, 3], [], [0]])
def test_unsupported_schemas_are_refused_without_mutation(tmp_path, versions):
    path = tmp_path / "jobs.sqlite"
    schema_one_database(path)
    with sqlite3.connect(path) as connection:
        connection.execute("DELETE FROM schema_version")
        connection.executemany(
            "INSERT INTO schema_version VALUES (?)", [(v,) for v in versions]
        )
    before = path.read_bytes()
    with pytest.raises(RuntimeError, match="Unsupported"):
        JobRepository(path)
    assert path.read_bytes() == before


def test_unrecoverable_legacy_archive_rolls_back_upgrade(tmp_path):
    path = tmp_path / "jobs.sqlite"
    schema_one_database(path)
    with sqlite3.connect(path) as connection:
        connection.execute(
            "DELETE FROM events WHERE job_id='archived' AND status!='archived'"
        )
    with pytest.raises(RuntimeError, match="archive"):
        JobRepository(path)
    with sqlite3.connect(path) as connection:
        assert (
            connection.execute("SELECT version FROM schema_version").fetchone()[0] == 1
        )
        columns = [row[1] for row in connection.execute("PRAGMA table_info(jobs)")]
        assert "history_revision" not in columns
        assert (
            connection.execute(
                "SELECT status FROM jobs WHERE id='archived'"
            ).fetchone()[0]
            == "archived"
        )


def test_concurrent_repository_open_runs_schema_upgrade_only_once(tmp_path):
    path = tmp_path / "jobs.sqlite"
    schema_one_database(path)
    with ThreadPoolExecutor(max_workers=3) as pool:
        repositories = list(pool.map(lambda _: JobRepository(path), range(3)))
    assert all(repo.get("archived")["status"] == "cancelled" for repo in repositories)
    with repositories[0].connect() as connection:
        assert [
            row[0] for row in connection.execute("SELECT version FROM schema_version")
        ] == [2]
