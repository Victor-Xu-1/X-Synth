"""History metadata uses real SQLite, independently of worker execution."""

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Event
from time import monotonic, sleep

import pytest

from packages.orchestrator import job_history, job_history_schema, job_repository
from packages.orchestrator.job_repository import JobConflict, JobRepository


@pytest.fixture
def repo(tmp_path):
    return JobRepository(tmp_path / "jobs.sqlite")


def history_item(job):
    return {"id": job["id"], "revision": job["history_revision"]}


def imported(repo, identifier, *, owner="alice", description=None, smiles="CCO"):
    repo.import_history(
        identifier=identifier,
        owner=owner,
        request={"smiles": smiles, "description": description},
        summary={"origin": "askcos_history", "stored_route_count": 3},
        created="2026-01-01",
        modified="2026-01-01",
        completed=True,
    )
    return repo.get(identifier)


def test_rename_preserves_execution_input_revision_and_events(repo):
    job = imported(repo, "one", description="original")
    events = repo.events(job["id"])
    updated = repo.edit_history(
        job["id"], owner="alice", description="display title", expected_revision=0
    )
    assert updated["request"] == job["request"]
    assert updated["revision"] == job["revision"]
    assert updated["checkpoint"] == job["checkpoint"]
    assert updated["modified"] == job["modified"]
    assert updated["history_title"] == "display title"
    assert updated["history_revision"] == 1
    assert repo.events(job["id"]) == events
    assert (
        JobRepository(repo.path).history_page("alice")["results"][0]["history_title"]
        == "display title"
    )


def test_running_job_can_rename_and_move_without_invalidating_worker(repo):
    job = repo.create("alice", {"smiles": "CCO", "description": "submitted"})
    group = repo.create_group("alice", "Experiments")
    renamed = repo.edit_history(
        job["id"],
        owner="alice",
        description="working",
        expected_revision=0,
        expected_history_revision=0,
    )
    repo.batch_history(
        "alice", action="group", items=[history_item(renamed)], group_id=group["id"]
    )
    claimed = repo.claim_next()
    assert claimed["id"] == job["id"]
    assert claimed["revision"] == 1
    assert claimed["history_revision"] == 2
    assert claimed["group_id"] == group["id"]
    checkpoint = {"children": {"1:mcts": "native-child"}, "pass_number": 1}
    searched = repo.transition(
        job["id"], "searching", expected_revision=1, checkpoint=checkpoint
    )
    assert searched["request"] == job["request"]
    assert searched["checkpoint"] == checkpoint
    assert searched["history_title"] == "working"
    assert searched["history_revision"] == 2
    with pytest.raises(JobConflict):
        repo.edit_history(
            job["id"], owner="alice", description="stale", expected_revision=0
        )
    with pytest.raises(JobConflict):
        repo.edit_history(
            job["id"],
            owner="alice",
            description="stale",
            expected_revision=searched["revision"],
            expected_history_revision=0,
        )


def test_worker_and_metadata_transactions_can_both_commit(repo):
    job = repo.create(
        "alice", {"smiles": "CCO", "description": "input"}, request_key="retry-key"
    )
    group = repo.create_group("alice", "Concurrent")
    claimed = repo.claim_next()
    checkpoint = {"children": {"1:mcts": "native"}, "pass_number": 1}
    with ThreadPoolExecutor(max_workers=2) as pool:
        worker = pool.submit(
            repo.transition,
            job["id"],
            "searching",
            expected_revision=claimed["revision"],
            checkpoint=checkpoint,
        )
        metadata = pool.submit(
            repo.batch_history,
            "alice",
            action="group",
            items=[history_item(job)],
            group_id=group["id"],
        )
        assert metadata.result() == 1
        assert worker.result()["status"] == "searching"
    after = repo.get(job["id"])
    assert after["revision"] == 2
    assert after["history_revision"] == 1
    assert after["group_id"] == group["id"]
    assert after["checkpoint"] == checkpoint
    assert (
        repo.create("alice", job["request"], request_key="retry-key")["id"] == job["id"]
    )


@pytest.mark.parametrize("first", ["metadata", "worker"])
@pytest.mark.parametrize("check_job_revision", [True, False])
def test_interleaved_metadata_edit_never_writes_stale_worker_data(
    repo,
    monkeypatch,
    first,
    check_job_revision,
):
    job = repo.create(
        "alice",
        {"smiles": "CCO", "description": "submitted", "tuning": {"max_depth": 12}},
    )
    repo.claim_next()
    baseline = repo.transition(
        job["id"],
        "searching",
        expected_revision=1,
        checkpoint={"pass_number": 1, "children": {"mcts": "child-1"}},
        summary={"selected_route_count": 1},
    )
    metadata_repo = JobRepository(repo.path)
    ready, attempted = Event(), Event()
    observed = []

    def controlled_connect(repository, *, first_writer, metadata_writer):
        connect = repository.connect

        @contextmanager
        def connection_with_gate():
            with connect() as connection:
                if metadata_writer:
                    connection.set_authorizer(
                        lambda action, table, column, *_: (
                            sqlite3.SQLITE_DENY
                            if action == sqlite3.SQLITE_UPDATE
                            and table == "jobs"
                            and column
                            not in {"history_title", "history_revision", "archived"}
                            else sqlite3.SQLITE_OK
                        )
                    )

                def trace(sql):
                    if first_writer and sql.startswith("UPDATE jobs SET"):
                        ready.set()
                        observed.append(attempted.wait(3))
                    elif not first_writer and sql == "BEGIN IMMEDIATE":
                        attempted.set()

                connection.set_trace_callback(trace)
                yield connection

        monkeypatch.setattr(repository, "connect", connection_with_gate)

    controlled_connect(repo, first_writer=first == "worker", metadata_writer=False)
    controlled_connect(
        metadata_repo, first_writer=first == "metadata", metadata_writer=True
    )
    checkpoint = {
        "pass_number": 2,
        "children": {"mcts": "child-1"},
        "completed_searches": ["1:mcts"],
    }

    def metadata():
        return metadata_repo.edit_history(
            job["id"],
            owner="alice",
            description="display",
            expected_revision=baseline["revision"] if check_job_revision else None,
            expected_history_revision=0,
        )

    def worker():
        return repo.transition(
            job["id"],
            "evaluating",
            expected_revision=baseline["revision"],
            checkpoint=checkpoint,
            summary={"selected_route_count": 2},
            error_code="worker-note",
        )

    operations = {"metadata": metadata, "worker": worker}
    with ThreadPoolExecutor(max_workers=2) as pool:
        first_result = pool.submit(operations[first])
        assert ready.wait(3), "First writer did not reach its locked UPDATE"
        second = "worker" if first == "metadata" else "metadata"
        second_result = pool.submit(operations[second])
        first_value = first_result.result(timeout=5)
        if first == "worker" and check_job_revision:
            with pytest.raises(JobConflict, match="job changed"):
                second_result.result(timeout=5)
            edited = None
        else:
            second_value = second_result.result(timeout=5)
            edited = first_value if first == "metadata" else second_value

    assert observed == [True]
    after = repo.get(job["id"])
    assert after["status"] == "evaluating"
    assert after["revision"] == baseline["revision"] + 1
    assert after["checkpoint"] == checkpoint
    assert after["summary"] == {"selected_route_count": 2}
    assert after["error_code"] == "worker-note"
    assert after["request"] == job["request"]
    assert after["history_revision"] == (0 if edited is None else 1)
    assert after["history_title"] == (None if edited is None else "display")
    assert len(repo.events(job["id"])) == 4
    if first == "worker" and edited is not None:
        assert edited["revision"] == after["revision"]
        assert edited["checkpoint"] == checkpoint
        assert edited["summary"] == after["summary"]


@pytest.mark.parametrize(
    "size,scope", [(32, "all"), (256, "all"), (32, "ungrouped"), (32, "group")]
)
def test_casefold_search_uses_owner_indexes_but_scans_substring_candidates(
    repo,
    monkeypatch,
    size,
    scope,
):
    jobs = [
        imported(repo, f"candidate-{index:04d}", description="Na\u00efve target")
        for index in range(size)
    ]
    imported(repo, "foreign", owner="bob", description="foreign-secret", smiles="CCN")
    archived = imported(repo, "archived", description="archived-secret")
    repo.batch_history("alice", action="archive", items=[history_item(archived)])
    group = repo.create_group("alice", "Selected")
    if scope != "all":
        repo.batch_history(
            "alice",
            action="group",
            items=[history_item(job) for job in jobs[::2]],
            group_id=group["id"],
        )
    connect = repo.connect
    folded, statements = [], []

    @contextmanager
    def counted_connection():
        with connect() as connection:

            def counted_casefold(value):
                folded.append(value)
                return value.casefold() if isinstance(value, str) else ""

            connection.create_function(
                "history_casefold", 1, counted_casefold, deterministic=True
            )
            connection.set_trace_callback(statements.append)
            yield connection

    monkeypatch.setattr(repo, "connect", counted_connection)
    group_filter = group["id"] if scope == "group" else scope
    page = repo.history_page(
        "alice", group=group_filter, query="\u00dfmissing", limit=1
    )
    assert page["total"] == 0
    assert page["results"] == []
    assert page["all_total"] == size
    candidates = size if scope == "all" else size // 2
    assert len(folded) == 6 * candidates
    assert "foreign-secret" not in folded
    assert "CCN" not in folded
    assert "archived-secret" not in folded
    page_sql = next(
        sql for sql in statements if "history_progress AS checkpoint" in sql
    )
    total_sql = next(
        sql
        for sql in statements
        if sql.startswith("SELECT COUNT(*)") and "instr(" in sql
    )
    with connect() as connection:
        page_plan = [
            row["detail"]
            for row in connection.execute("EXPLAIN QUERY PLAN " + page_sql)
        ]
        total_plan = [
            row["detail"]
            for row in connection.execute("EXPLAIN QUERY PLAN " + total_sql)
        ]
    index = "jobs_history_page" if scope == "all" else "jobs_history_group"
    assert any("SEARCH jobs USING INDEX " + index in detail for detail in page_plan)
    assert any(index in detail and "owner=?" in detail for detail in total_plan)
    assert not any("TEMP B-TREE" in detail for detail in page_plan)
    print(
        f"scope={scope}, candidates={candidates}, casefold_calls={len(folded)}, page_plan={page_plan}, total_plan={total_plan}"
    )


@pytest.mark.parametrize(
    "status",
    [
        "completed",
        "failed_unclosed",
        "failed",
        "cancelled",
        "completed_not_enough_routes",
        "legacy_completed",
        "legacy_incomplete",
    ],
)
def test_each_terminal_status_survives_archive_and_restore(repo, status):
    job = imported(repo, "terminal")
    with repo.connect() as connection:
        connection.execute("UPDATE jobs SET status=? WHERE id=?", (status, job["id"]))
        connection.commit()
    repo.batch_history("alice", action="archive", items=[history_item(job)])
    archived = repo.get(job["id"])
    assert archived["status"] == status
    assert repo.history_page("alice", archived=True, status=status)["total"] == 1
    repo.batch_history("alice", action="restore", items=[history_item(archived)])
    assert repo.get(job["id"])["status"] == status


def test_archive_is_recoverable_and_does_not_rewrite_status(repo):
    job = imported(repo, "archivable")
    events = repo.events(job["id"])
    group = repo.create_group("alice", "Kept")
    repo.batch_history(
        "alice", action="group", items=[history_item(job)], group_id=group["id"]
    )
    grouped = repo.get(job["id"])
    assert (
        repo.batch_history("alice", action="archive", items=[history_item(grouped)])
        == 1
    )
    archived = repo.get(job["id"])
    assert archived["archived"] is True
    assert archived["status"] == job["status"]
    assert archived["revision"] == job["revision"]
    assert archived["request"] == job["request"]
    assert repo.events(job["id"]) == events
    assert repo.count("alice") == 0
    assert repo.list("alice") == []
    trash = JobRepository(repo.path).history_page("alice", archived=True)
    assert trash["total"] == 1
    assert trash["all_total"] == 0
    assert trash["results"][0]["id"] == job["id"]
    assert (
        repo.batch_history("alice", action="restore", items=[history_item(archived)])
        == 1
    )
    restored = repo.get(job["id"])
    assert restored["archived"] is False
    assert restored["group_id"] == group["id"]
    assert restored["history_revision"] == 3
    assert repo.count("alice") == 1


@pytest.mark.parametrize("failure", ["foreign", "missing", "stale", "running"])
def test_batch_validation_rolls_back_every_item(repo, failure):
    first = imported(repo, "first")
    second = imported(repo, "second", owner="bob" if failure == "foreign" else "alice")
    if failure == "running":
        second = repo.create("alice", {"smiles": "CCN"})
    items = [history_item(first), history_item(second)]
    if failure == "missing":
        items[1]["id"] = "absent"
    if failure == "stale":
        items[1]["revision"] += 1
    error = KeyError if failure in {"missing", "foreign"} else JobConflict
    with pytest.raises(error):
        repo.batch_history("alice", action="archive", items=items)
    assert repo.get(first["id"]) == first
    assert repo.get(second["id"]) == second


def test_sql_failure_after_first_batch_write_rolls_back_all_metadata(repo):
    first, second = imported(repo, "first"), imported(repo, "second")
    with repo.connect() as connection:
        connection.execute("""CREATE TRIGGER reject_second BEFORE UPDATE OF archived ON jobs
            WHEN NEW.id='second' BEGIN SELECT RAISE(ABORT,'injected database failure'); END""")
        connection.commit()
    with pytest.raises(sqlite3.IntegrityError, match="injected database failure"):
        repo.batch_history(
            "alice", action="archive", items=[history_item(first), history_item(second)]
        )
    assert repo.get("first") == first
    assert repo.get("second") == second


def test_foreign_groups_and_tasks_are_not_visible_or_mutable(repo):
    group = repo.create_group("bob", "Private")
    job = imported(repo, "mine")
    foreign = imported(repo, "theirs", owner="bob")
    assert repo.list_groups("alice") == []
    for operation in (
        lambda: repo.update_group(
            "alice", group["id"], name="attack", expected_revision=0
        ),
        lambda: repo.delete_group("alice", group["id"], expected_revision=0),
        lambda: repo.history_page("alice", group=group["id"]),
        lambda: repo.batch_history(
            "alice", action="group", items=[history_item(job)], group_id=group["id"]
        ),
        lambda: repo.edit_history(
            foreign["id"], owner="alice", description="attack", expected_revision=0
        ),
        lambda: repo.batch_history(
            "alice", action="restore", items=[history_item(foreign)]
        ),
    ):
        with pytest.raises(KeyError):
            operation()
    assert repo.get(job["id"]) == job
    assert repo.get(foreign["id"]) == foreign
    assert repo.list_groups("bob")[0] == group


def test_group_rename_delete_and_revision_conflicts_preserve_jobs(repo):
    group = repo.create_group("alice", "First")
    jobs = [imported(repo, name) for name in ("one", "two")]
    repo.batch_history(
        "alice",
        action="group",
        items=[history_item(job) for job in jobs],
        group_id=group["id"],
    )
    grouped = [repo.get(job["id"]) for job in jobs]
    repo.batch_history("alice", action="archive", items=[history_item(grouped[1])])
    renamed = repo.update_group(
        "alice", group["id"], name="Second", expected_revision=0
    )
    assert renamed == {"id": group["id"], "name": "Second", "revision": 1, "count": 1}
    with pytest.raises(JobConflict):
        repo.delete_group("alice", group["id"], expected_revision=0)
    assert repo.get(jobs[0]["id"])["group_id"] == group["id"]
    repo.delete_group("alice", group["id"], expected_revision=1)
    assert repo.list_groups("alice") == []
    for before in grouped:
        after = repo.get(before["id"])
        assert after["group_id"] is None
        assert after["revision"] == before["revision"]
        assert after["request"] == before["request"]
        assert after["history_revision"] == before["history_revision"] + (
            2 if after["archived"] else 1
        )
        with pytest.raises(JobConflict):
            repo.batch_history(
                "alice", action="group", items=[history_item(before)], group_id=None
            )


def test_group_delete_sql_failure_rolls_back_detached_tasks(repo):
    job = imported(repo, "one")
    group = repo.create_group("alice", "Kept")
    repo.batch_history(
        "alice", action="group", items=[history_item(job)], group_id=group["id"]
    )
    before = repo.get(job["id"])
    with repo.connect() as connection:
        connection.execute("""CREATE TRIGGER reject_group_delete BEFORE DELETE ON job_groups
            BEGIN SELECT RAISE(ABORT,'injected group failure'); END""")
        connection.commit()
    with pytest.raises(sqlite3.IntegrityError, match="injected group failure"):
        repo.delete_group("alice", group["id"], expected_revision=0)
    assert repo.get(job["id"]) == before
    assert repo.list_groups("alice")[0]["count"] == 1


def test_duplicate_group_names_and_stale_renames_do_not_partially_write(repo):
    first = repo.create_group("alice", "First")
    second = repo.create_group("alice", "Second")
    with pytest.raises(JobConflict):
        repo.create_group("alice", "First")
    with pytest.raises(JobConflict):
        repo.update_group("alice", second["id"], name="First", expected_revision=0)
    with pytest.raises(JobConflict):
        repo.update_group("alice", first["id"], name="Changed", expected_revision=1)
    assert repo.list_groups("alice") == [first, second]
    assert repo.create_group("bob", "First")["name"] == "First"


def test_concurrent_metadata_edits_have_one_winner(repo):
    job = imported(repo, "concurrent")

    def rename(name):
        try:
            repo.edit_history(
                job["id"],
                owner="alice",
                description=name,
                expected_revision=0,
                expected_history_revision=0,
            )
            return True
        except JobConflict:
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(rename, ("first", "second"))) == 1
    assert repo.get(job["id"])["history_revision"] == 1
    assert len(repo.events(job["id"])) == 1


def test_server_filters_search_all_pages_and_use_stable_tie_order(repo):
    for index in range(130):
        imported(
            repo,
            f"item-{index:03d}",
            description=f"sample {index}",
            smiles="CCN" if index == 5 else "CCO",
        )
    group = repo.create_group("alice", "Selected")
    target = repo.get("item-005")
    repo.batch_history(
        "alice", action="group", items=[history_item(target)], group_id=group["id"]
    )
    for query in ("sample 5", "CCN", "item-005"):
        page = repo.history_page(
            "alice", limit=1, query=query, status="legacy_completed"
        )
        assert page["total"] >= 1
        assert page["all_total"] == 130
        assert page["ungrouped_total"] == 129
        assert page["groups"][0]["count"] == 1
    page = repo.history_page("alice", limit=24, group=group["id"], query="CCN")
    assert [row["id"] for row in page["results"]] == ["item-005"]
    assert page["total"] == 1
    rows = []
    for offset in range(0, 130, 24):
        rows.extend(
            row["id"]
            for row in repo.history_page("alice", limit=24, offset=offset)["results"]
        )
    assert rows == sorted(rows, reverse=True)
    assert len(set(rows)) == 130
    assert repo.history_page("alice", offset=200)["total"] == 130
    assert repo.history_page("alice", offset=200)["results"] == []
    assert repo.history_page("alice", group="ungrouped")["total"] == 129


def test_search_uses_display_title_and_literal_case_insensitive_substrings(repo):
    job = imported(repo, "literal", description="original")
    repo.edit_history(
        job["id"], owner="alice", description="Mixed %_' title", expected_revision=0
    )
    assert repo.history_page("alice", query="mixed %_'")["total"] == 1
    assert repo.history_page("alice", query="original")["total"] == 0
    assert repo.history_page("alice", query="' OR 1=1 --")["total"] == 0
    assert repo.history_page("alice", query="LITERAL")["total"] == 1
    repo.edit_history(
        job["id"], owner="alice", description="Stra\u00dfe", expected_revision=0
    )
    assert repo.history_page("alice", query="STRASSE")["total"] == 1


def test_active_filter_includes_waiting_but_not_legacy_incomplete(repo):
    queued = repo.create("alice", {"smiles": "CCO"})
    claimed = repo.claim_next()
    repo.transition(claimed["id"], "waiting_for_engine", expected_revision=1)
    imported(repo, "old")
    assert repo.history_page("alice", status="active")["total"] == 1
    assert (
        repo.history_page("alice", status="waiting_for_engine")["results"][0]["id"]
        == queued["id"]
    )


def test_history_page_and_legacy_list_never_select_large_checkpoint(repo, monkeypatch):
    job = repo.create("alice", {"smiles": "CCO"})
    repo.claim_next()
    repo.transition(
        job["id"],
        "searching",
        expected_revision=1,
        checkpoint={
            "pass_number": 1,
            "completed_searches": ["1:mcts"],
            "native_progress": {"mcts": {"elapsed": 5, "nodes": 12}},
            "search_graph": {"large": "x" * 2_000_000},
        },
    )
    connect = repo.connect

    @contextmanager
    def projection_only():
        with connect() as connection:
            connection.set_authorizer(
                lambda action, table, column, *_: (
                    sqlite3.SQLITE_DENY
                    if action == sqlite3.SQLITE_READ
                    and table == "jobs"
                    and column == "checkpoint"
                    else sqlite3.SQLITE_OK
                )
            )
            yield connection

    monkeypatch.setattr(repo, "connect", projection_only)
    row = repo.history_page("alice")["results"][0]
    assert row["checkpoint"]["pass_number"] == 1
    assert "search_graph" not in row["checkpoint"]
    assert row["checkpoint"]["native_progress"]["mcts"]["nodes"] == 12
    assert repo.list("alice")[0]["id"] == job["id"]


def test_progress_projection_is_bounded_without_changing_checkpoint(repo):
    job = repo.create("alice", {"smiles": "CCO"})
    repo.claim_next()
    checkpoint = {
        "pass_number": 1,
        "native_progress": {
            "mcts": {
                "iterations": 4,
                "chemicals": 12,
                "reactions": 7,
                "elapsed_seconds": 1.5,
                "nodes": 10**400,
                "phase": "x" * 257,
                "graph": {"large": "x" * 1_000_000},
                "checkpoint_path": "/private/native/checkpoint.json",
            }
        },
    }
    worker = repo.transition(
        job["id"], "searching", expected_revision=1, checkpoint=checkpoint
    )
    page = repo.history_page("alice")
    counters = page["results"][0]["checkpoint"]["native_progress"]["mcts"]
    assert counters == {
        "iterations": 4,
        "chemicals": 12,
        "reactions": 7,
        "elapsed_seconds": 1.5,
    }
    assert worker["checkpoint"] == checkpoint
    assert len(str(page)) < 5000


def test_page_counts_and_rows_share_one_snapshot_during_archive(repo, monkeypatch):
    job = imported(repo, "snapshot")
    writer = JobRepository(repo.path)
    connect = repo.connect
    writes = []

    @contextmanager
    def interleaved():
        with connect() as connection:

            def before_page(sql):
                if "history_progress AS checkpoint" in sql and not writes:
                    writes.append(
                        writer.batch_history(
                            "alice", action="archive", items=[history_item(job)]
                        )
                    )

            connection.set_trace_callback(before_page)
            yield connection

    monkeypatch.setattr(repo, "connect", interleaved)
    page = repo.history_page("alice")
    assert writes == [1]
    assert page["total"] == page["all_total"] == page["ungrouped_total"] == 1
    assert [row["id"] for row in page["results"]] == [job["id"]]
    assert page["results"][0]["archived"] is False
    assert writer.count("alice") == 0


@pytest.mark.parametrize(
    "kwargs",
    [
        {"limit": 101},
        {"limit": 0},
        {"offset": -1},
        {"limit": True},
        {"offset": 2**63},
        {"status": "invented"},
        {"query": "x" * 20_001},
        {"archived": "false"},
    ],
)
def test_invalid_page_parameters_are_rejected(repo, kwargs):
    with pytest.raises(ValueError):
        repo.history_page("alice", **kwargs)


@pytest.mark.parametrize("name", ["", "   ", "x" * 129])
def test_invalid_group_names_are_rejected_without_writes(repo, name):
    with pytest.raises(ValueError):
        repo.create_group("alice", name)
    assert repo.list_groups("alice") == []


@pytest.mark.parametrize("name", ["", "   ", "x" * 257])
def test_invalid_titles_are_rejected_without_writes(repo, name):
    job = imported(repo, "one")
    with pytest.raises(ValueError):
        repo.edit_history(
            job["id"], owner="alice", description=name, expected_revision=0
        )
    assert repo.get(job["id"]) == job


@pytest.mark.parametrize(
    "items",
    [
        [],
        [{"id": "one", "revision": 0}] * 101,
        [{"id": "one", "revision": 0}, {"id": "one", "revision": 0}],
        [{"id": "one", "revision": -1}],
        [{"id": "one", "revision": True}],
        [{"id": "", "revision": 0}],
    ],
)
def test_invalid_batch_parameters_do_not_write(repo, items):
    job = imported(repo, "one")
    with pytest.raises(ValueError):
        repo.batch_history("alice", action="archive", items=items)
    assert repo.get(job["id"]) == job


def test_batch_limit_of_one_hundred_is_supported(repo):
    jobs = [imported(repo, f"bulk-{index}") for index in range(100)]
    assert (
        repo.batch_history(
            "alice", action="archive", items=[history_item(job) for job in jobs]
        )
        == 100
    )
    assert repo.count("alice") == 0
    assert repo.history_page("alice", archived=True, limit=100)["total"] == 100


def stored_history(repo):
    with repo.connect() as connection:
        return {
            table: [
                tuple(row)
                for row in connection.execute(
                    "SELECT * FROM "
                    + table
                    + (" ORDER BY 1,2" if table == "events" else " ORDER BY 1")
                )
            ]
            for table in ("jobs", "events", "job_groups", "schema_version")
        }


def query_budget_fixture(repo, size=160):
    with repo.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.executemany(
            """INSERT INTO jobs(id,owner,status,request,created,modified)
               VALUES (?,'alice','legacy_completed',?,'2026-01-01','2026-01-01')""",
            [
                (
                    f"budget-{index:04d}",
                    json.dumps({"smiles": "CCO", "description": f"target-{index}"}),
                )
                for index in range(size)
            ],
        )
        connection.commit()
    foreign = imported(repo, "budget-foreign", owner="bob")
    archived = imported(repo, "budget-archived")
    repo.batch_history("alice", action="archive", items=[history_item(archived)])
    group = repo.create_group("alice", "Kept")
    repo.batch_history(
        "alice",
        action="group",
        items=[{"id": "budget-0000", "revision": 0}],
        group_id=group["id"],
    )
    return foreign, archived, group


def test_history_query_budget_really_interrupts_sqlite_and_cleans_connection(
    repo, monkeypatch
):
    foreign, archived, group = query_budget_fixture(repo)
    before = stored_history(repo)
    monkeypatch.setenv("X_SYNTH_HISTORY_QUERY_SECONDS", "0.02")
    repo.history = job_history.JobHistory(repo)
    connect = repo.connect
    probes, statements = [], []

    @contextmanager
    def slow_connection():
        with connect() as connection:

            def slow_casefold(value):
                sleep(0.001)
                return value.casefold() if isinstance(value, str) else ""

            connection.create_function(
                "history_casefold", 1, slow_casefold, deterministic=True
            )
            connection.set_trace_callback(statements.append)
            try:
                yield connection
            finally:
                recovered = connection.execute(
                    """WITH RECURSIVE seq(n) AS (
                       VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<2000)
                       SELECT SUM(n) FROM seq"""
                ).fetchone()[0]
                probes.append((recovered, connection.in_transaction))

    with monkeypatch.context() as scoped:
        scoped.setattr(repo, "connect", slow_connection)
        started = monotonic()
        with pytest.raises(job_history.HistoryQueryUnavailable) as error:
            repo.history_page("alice", query="not-present", limit=1)
        elapsed = monotonic() - started
    assert error.value.code == "history_query_timeout"
    assert error.value.__cause__.sqlite_errorcode == sqlite3.SQLITE_INTERRUPT
    assert 0.02 <= elapsed < 1.0
    assert probes == [(2_001_000, False)]
    pragmas = [sql for sql in statements if sql.startswith("PRAGMA busy_timeout=")]
    assert len(pragmas) == 1
    assert 0 <= int(pragmas[0].split("=")[1]) <= 20
    assert stored_history(repo) == before
    monkeypatch.delenv("X_SYNTH_HISTORY_QUERY_SECONDS")
    recovered = JobRepository(repo.path)
    page = recovered.history_page("alice")
    assert page["total"] == page["all_total"] == 160
    assert page["groups"] == [{**group, "count": 1}]
    assert recovered.get(foreign["id"], owner="alice") is None
    assert (
        recovered.history_page("alice", archived=True)["results"][0]["id"]
        == archived["id"]
    )
    with recovered.connect() as connection:
        assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


@pytest.mark.parametrize("target", ["all_total", "groups", "page", "single_groups"])
def test_history_query_deadline_covers_short_statements_and_every_page_count(
    repo,
    monkeypatch,
    target,
):
    job = imported(repo, "one")
    repo.create_group("alice", "Kept")
    before = stored_history(repo)
    monkeypatch.setenv("X_SYNTH_HISTORY_QUERY_SECONDS", "0.02")
    repo.history = job_history.JobHistory(repo)
    connect = repo.connect
    delayed = []

    @contextmanager
    def delayed_connection():
        with connect() as connection:

            def trace(sql):
                matches = (
                    target == "all_total"
                    and "AS all_total" in sql
                    or target in {"groups", "single_groups"}
                    and "FROM job_groups g" in sql
                    or target == "page"
                    and "history_progress AS checkpoint" in sql
                )
                if matches:
                    delayed.append(sql)
                    sleep(0.04)

            connection.set_trace_callback(trace)
            yield connection

    with monkeypatch.context() as scoped:
        scoped.setattr(repo, "connect", delayed_connection)
        with pytest.raises(job_history.HistoryQueryUnavailable):
            if target == "single_groups":
                repo.list_groups("alice")
            else:
                repo.history_page("alice")
    assert len(delayed) == 1
    assert stored_history(repo) == before
    assert repo.get(job["id"])["history_revision"] == 0


def test_history_query_uses_one_deadline_across_multiple_short_statements(
    repo, monkeypatch
):
    imported(repo, "one")
    repo.create_group("alice", "Kept")
    before = stored_history(repo)
    monkeypatch.setenv("X_SYNTH_HISTORY_QUERY_SECONDS", "0.025")
    repo.history = job_history.JobHistory(repo)
    connect = repo.connect
    statements = []

    @contextmanager
    def delayed_connection():
        with connect() as connection:

            def trace(sql):
                if sql.lstrip().startswith("SELECT"):
                    statements.append(sql)
                    sleep(0.009)

            connection.set_trace_callback(trace)
            yield connection

    with monkeypatch.context() as scoped:
        scoped.setattr(repo, "connect", delayed_connection)
        with pytest.raises(job_history.HistoryQueryUnavailable):
            repo.history_page("alice")
    assert len(statements) >= 3
    assert stored_history(repo) == before


def test_history_query_handler_is_also_cleared_after_success(repo, monkeypatch):
    job = imported(repo, "one")
    monkeypatch.setenv("X_SYNTH_HISTORY_QUERY_SECONDS", "0.05")
    repo.history = job_history.JobHistory(repo)
    connect = repo.connect
    probes = []

    @contextmanager
    def checked_connection():
        with connect() as connection:
            try:
                yield connection
            finally:
                sleep(0.06)
                total = connection.execute(
                    """WITH RECURSIVE seq(n) AS (
                       VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<2000)
                       SELECT SUM(n) FROM seq"""
                ).fetchone()[0]
                probes.append((total, connection.in_transaction))

    with monkeypatch.context() as scoped:
        scoped.setattr(repo, "connect", checked_connection)
        page = repo.history_page("alice")
    assert page["results"][0]["id"] == job["id"]
    assert probes == [(2_001_000, False)]


@pytest.mark.parametrize("raw", ["nan", "inf", "-inf"])
def test_history_query_budget_rejects_nonfinite_configuration(repo, monkeypatch, raw):
    before = stored_history(repo)
    monkeypatch.setenv("X_SYNTH_HISTORY_QUERY_SECONDS", raw)
    with pytest.raises(ValueError):
        job_history.JobHistory(repo)
    assert stored_history(repo) == before


@pytest.mark.parametrize(
    "sql,parameters,error_type",
    [
        ("SELECT absent_column FROM jobs", (), sqlite3.OperationalError),
        ("SELECT ?", (1, 2), sqlite3.ProgrammingError),
    ],
)
def test_history_query_guard_does_not_swallow_sql_programming_errors(
    repo,
    sql,
    parameters,
    error_type,
):
    before = stored_history(repo)
    with (
        pytest.raises(error_type) as error,
        repo.history._read_connection() as connection,
    ):
        connection.execute(sql, parameters)
    assert not isinstance(error.value, job_history.HistoryQueryUnavailable)
    assert stored_history(repo) == before


def test_history_query_busy_is_bounded_without_changing_worker_connect(
    repo, monkeypatch
):
    imported(repo, "one")
    before = stored_history(repo)
    monkeypatch.setenv("X_SYNTH_HISTORY_QUERY_SECONDS", "0.02")
    repo.history = job_history.JobHistory(repo)
    with repo.connect() as setup:
        setup.execute("PRAGMA journal_mode=DELETE")
    reader = sqlite3.connect(repo.path, timeout=5)
    reader.row_factory = sqlite3.Row
    with sqlite3.connect(repo.path) as locker:
        locker.execute("BEGIN EXCLUSIVE")
        try:
            with monkeypatch.context() as scoped:

                @contextmanager
                def read_connection():
                    try:
                        yield reader
                    finally:
                        reader.close()

                scoped.setattr(repo, "connect", read_connection)
                started = monotonic()
                with pytest.raises(job_history.HistoryQueryUnavailable) as error:
                    repo.history_page("alice")
                assert monotonic() - started < 0.5
            assert error.value.__cause__.sqlite_errorcode & 255 == sqlite3.SQLITE_BUSY
        finally:
            locker.rollback()
    assert stored_history(repo) == before
    with repo.connect() as worker:
        assert worker.execute("PRAGMA busy_timeout").fetchone()[0] == 5000


def test_history_query_locked_uses_real_sqlite_extended_error(repo, monkeypatch):
    job = imported(repo, "one")
    before = stored_history(repo)
    uri = repo.path.as_uri() + "?cache=shared"
    with sqlite3.connect(uri, uri=True) as locker:
        locker.execute("BEGIN IMMEDIATE")
        locker.execute(
            "UPDATE jobs SET history_title=history_title WHERE id=?", (job["id"],)
        )
        try:
            with monkeypatch.context() as scoped:

                @contextmanager
                def shared_connection():
                    connection = sqlite3.connect(uri, uri=True, timeout=5)
                    connection.row_factory = sqlite3.Row
                    try:
                        yield connection
                    finally:
                        connection.close()

                scoped.setattr(repo, "connect", shared_connection)
                with pytest.raises(job_history.HistoryQueryUnavailable) as error:
                    repo.history_page("alice")
            assert error.value.__cause__.sqlite_errorcode & 255 == sqlite3.SQLITE_LOCKED
        finally:
            locker.rollback()
    assert stored_history(repo) == before


def test_history_compatibility_exports_keep_the_same_objects():
    for name in ("TERMINAL_STATES", "initialize_schema", "progress_projection"):
        assert name in job_history.__all__
        assert name in job_repository.__all__
        assert getattr(job_history, name) is getattr(job_history_schema, name)
        assert getattr(job_repository, name) is getattr(job_history_schema, name)
    assert "JobConflict" in job_repository.__all__
    assert job_repository.JobConflict is job_history.JobConflict


@pytest.mark.parametrize("checkpoint", ["[]", "null", '"legacy text"', "{broken"])
def test_invalid_legacy_checkpoint_refuses_upgrade_as_runtime_error(
    tmp_path, checkpoint
):
    path = tmp_path / "legacy.sqlite"
    with sqlite3.connect(path) as connection:
        connection.executescript("""
            CREATE TABLE schema_version(version INTEGER PRIMARY KEY);
            INSERT INTO schema_version VALUES(1);
            CREATE TABLE jobs(
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL,
                request TEXT NOT NULL, request_key TEXT, revision INTEGER NOT NULL DEFAULT 0,
                created TEXT NOT NULL, modified TEXT NOT NULL, summary TEXT,
                checkpoint TEXT NOT NULL DEFAULT '{}', error_code TEXT,
                UNIQUE(owner,request_key)
            );
            CREATE TABLE events(
                job_id TEXT NOT NULL REFERENCES jobs(id), revision INTEGER NOT NULL,
                at TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(job_id,revision)
            );
        """)
        connection.execute(
            """INSERT INTO jobs(id,owner,status,request,created,modified,checkpoint)
               VALUES('legacy','alice','legacy_completed',?,'2026-01-01','2026-01-01',?)""",
            (json.dumps({"smiles": "CCO"}), checkpoint),
        )
        connection.execute(
            "INSERT INTO events VALUES('legacy',0,'2026-01-01','legacy_completed')"
        )
        connection.commit()
        before = list(connection.iterdump())
    with pytest.raises(RuntimeError, match="Invalid legacy job checkpoint") as error:
        JobRepository(path)
    assert isinstance(error.value, job_history_schema.HistorySchemaError)
    with sqlite3.connect(path) as connection:
        assert list(connection.iterdump()) == before
        assert (
            connection.execute("SELECT version FROM schema_version").fetchone()[0] == 1
        )
        assert "history_revision" not in {
            row[1] for row in connection.execute("PRAGMA table_info(jobs)")
        }
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
