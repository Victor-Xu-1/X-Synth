"""Preserved native results remain viewable without new closure claims."""

import json
import sqlite3
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from time import sleep
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from apps.api.job_views import job_response, route_result
from apps.api.result_routes import result_router
from packages.orchestrator.job_history import JobHistory
from packages.orchestrator.job_repository import JobRepository
from packages.workspace.history_projection import historical_routes


def native_payload():
    path = (
        Path(__file__).resolve().parents[1]
        / "fixtures/askcos/diphenhydramine_retrostar_result.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def test_native_uds_projection_preserves_steps_but_does_not_recertify_closure():
    payload = native_payload()
    before = deepcopy(payload)
    routes = historical_routes(payload)
    assert routes
    assert all(route["steps"] for route in routes)
    assert all(route["engine"] == "askcos_history" for route in routes)
    assert all(route["closed"] is False for route in routes)
    assert all(route["closure_sources"] == [] for route in routes)
    assert all(route["route_score"] is None for route in routes)
    assert all(route["metadata"]["historical_unreviewed"] for route in routes)
    assert payload == before


def test_historical_result_uses_shared_viewer_and_retains_immutable_native_artifact(
    tmp_path,
):
    identifier = "a" * 32
    directory = tmp_path / identifier
    directory.mkdir()
    path = directory / "native-history.json"
    payload = native_payload()
    path.write_text(json.dumps(payload), encoding="utf-8")
    original = path.read_bytes()
    job = {
        "id": identifier,
        "status": "legacy_completed",
        "summary": {
            "origin": "askcos_history",
            "commercial_closure_revalidated": False,
        },
    }
    result = route_result(
        job, artifacts=tmp_path, budget=SimpleNamespace(response_bytes=32 * 1024**2)
    )
    assert result["result_state"] == "legacy_completed"
    assert result["result"]["unified_route_pool"]["selected_routes"]
    assert result["history_provenance"]["commercial_closure_revalidated"] is False
    assert path.read_bytes() == original
    with pytest.raises(HTTPException) as error:
        route_result(
            job,
            artifacts=tmp_path,
            budget=SimpleNamespace(response_bytes=len(original)),
        )
    assert error.value.status_code == 413


@pytest.fixture
def history_api(tmp_path, monkeypatch):
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    repository = JobRepository(tmp_path / "jobs.sqlite")
    application = FastAPI()
    application.include_router(
        result_router(repository=repository, transport=None), prefix="/api"
    )
    with TestClient(
        application, base_url="http://127.0.0.1", client=("127.0.0.1", 1234)
    ) as browser:
        yield repository, browser


def import_api_job(repository, identifier="one", *, owner="local_workspace"):
    repository.import_history(
        identifier=identifier,
        owner=owner,
        request={"smiles": "CCO", "description": identifier},
        summary={"origin": "askcos_history", "stored_route_count": 3},
        created="2026-01-01",
        modified="2026-01-01",
        completed=True,
    )
    return repository.get(identifier)


def test_page_wire_contract_and_old_list_share_metadata_authority(history_api):
    repository, browser = history_api
    job = import_api_job(repository)
    import_api_job(repository, "foreign", owner="other")
    response = browser.get("/api/v1/results/page")
    assert response.status_code == 200
    page = response.json()
    assert set(page) == {"results", "total", "all_total", "ungrouped_total", "groups"}
    assert page["total"] == page["all_total"] == page["ungrouped_total"] == 1
    result = page["results"][0]
    assert result["result_id"] == job["id"]
    assert result["target_smiles"] == "CCO"
    assert result["num_trees"] == 3
    assert result["group_id"] is None
    assert result["history_revision"] == 0
    renamed = browser.put(
        "/api/v1/results/update",
        params={"result_id": job["id"]},
        json={"description": "renamed", "revision": 0, "history_revision": 0},
    )
    assert renamed.status_code == 200
    assert renamed.json() == {"success": True, "revision": 0, "history_revision": 1}
    for url in ("/api/results/list", "/api/v1/results/list"):
        row = browser.get(url).json()[0]
        assert row["description"] == "renamed"
        assert row["revision"] == 0
        assert row["history_revision"] == 1
    assert repository.get(job["id"])["request"] == job["request"]
    stale = browser.put(
        "/api/v1/results/update",
        params={"result_id": job["id"]},
        json={"description": "stale", "revision": 0, "history_revision": 0},
    )
    assert stale.status_code == 409
    assert (
        browser.put(
            "/api/results/update",
            params={"result_id": job["id"]},
            json={"description": "old caller", "revision": 0},
        ).status_code
        == 200
    )


def test_group_and_batch_api_preserve_worker_state_and_support_restore(history_api):
    repository, browser = history_api
    job = repository.create(
        "local_workspace", {"smiles": "CCO", "description": "input"}
    )
    group_response = browser.post("/api/v1/results/groups", json={"name": "Project"})
    assert group_response.status_code == 200
    group = group_response.json()
    assert group == {"id": group["id"], "name": "Project", "revision": 0, "count": 0}
    body = {
        "action": "group",
        "items": [{"id": job["id"], "revision": 0}],
        "group_id": group["id"],
    }
    moved = browser.post("/api/v1/results/batch", json=body)
    assert moved.status_code == 200
    assert moved.json() == {"success": True, "count": 1}
    assert browser.get("/api/v1/results/groups").json()[0]["count"] == 1
    assert (
        browser.put(
            "/api/v1/results/update",
            params={"result_id": job["id"]},
            json={"description": "running title", "revision": 0, "history_revision": 1},
        ).status_code
        == 200
    )
    assert (
        browser.delete(
            "/api/results/destroy", params={"result_id": job["id"]}
        ).status_code
        == 409
    )
    assert (
        browser.post(
            "/api/v1/results/batch",
            json={"action": "archive", "items": [{"id": job["id"], "revision": 2}]},
        ).status_code
        == 409
    )
    terminal = repository.transition(job["id"], "cancelled", expected_revision=0)
    events = repository.events(job["id"])
    assert (
        browser.delete(
            "/api/results/destroy", params={"result_id": job["id"]}
        ).status_code
        == 200
    )
    archived = repository.get(job["id"])
    assert archived["revision"] == terminal["revision"]
    assert archived["status"] == "cancelled"
    assert archived["history_revision"] == 3
    assert browser.get("/api/results/list").json() == []
    trash = browser.get(
        "/api/v1/results/page", params={"archived": True, "status": "cancelled"}
    ).json()
    assert trash["total"] == 1
    assert trash["results"][0]["result_state"] == "cancelled"
    restored = browser.post(
        "/api/v1/results/batch",
        json={"action": "restore", "items": [{"id": job["id"], "revision": 3}]},
    )
    assert restored.json() == {"success": True, "count": 1}
    assert repository.events(job["id"]) == events
    updated_group = browser.put(
        "/api/v1/results/groups/" + group["id"], json={"name": "Renamed", "revision": 0}
    )
    assert updated_group.json() == {
        "id": group["id"],
        "name": "Renamed",
        "revision": 1,
        "count": 1,
    }
    assert (
        browser.delete(
            "/api/v1/results/groups/" + group["id"], params={"revision": 0}
        ).status_code
        == 409
    )
    assert browser.delete(
        "/api/v1/results/groups/" + group["id"], params={"revision": 1}
    ).json() == {"success": True}
    assert repository.get(job["id"])["group_id"] is None
    assert repository.get(job["id"])["history_revision"] == 5


def test_page_api_searches_beyond_first_page_and_combines_all_filters(history_api):
    repository, browser = history_api
    for index in range(125):
        import_api_job(repository, f"record-{index:03d}")
    group = repository.create_group("local_workspace", "Selected")
    repository.batch_history(
        "local_workspace",
        action="group",
        items=[{"id": "record-001", "revision": 0}],
        group_id=group["id"],
    )
    response = browser.get(
        "/api/v1/results/page",
        params={
            "query": "record-001",
            "group": group["id"],
            "status": "legacy_completed",
            "limit": 24,
        },
    )
    assert response.status_code == 200
    page = response.json()
    assert page["total"] == 1
    assert page["all_total"] == 125
    assert page["ungrouped_total"] == 124
    assert [row["result_id"] for row in page["results"]] == ["record-001"]
    assert (
        browser.get("/api/v1/results/page", params={"offset": 120, "limit": 24}).json()[
            "total"
        ]
        == 125
    )
    assert (
        browser.get(
            "/api/v1/results/page", params={"query": "CCO", "limit": 100}
        ).json()["total"]
        == 125
    )


def test_history_api_owner_checks_and_batch_revision_failure_are_atomic(history_api):
    repository, browser = history_api
    import_api_job(repository)
    import_api_job(repository, "other", owner="other")
    foreign_group = repository.create_group("other", "Secret")
    batch = {
        "action": "archive",
        "items": [{"id": "one", "revision": 0}, {"id": "other", "revision": 0}],
    }
    assert browser.post("/api/v1/results/batch", json=batch).status_code == 404
    assert repository.get("one")["archived"] is False
    batch["items"][1] = {"id": "one", "revision": 1}
    assert browser.post("/api/v1/results/batch", json=batch).status_code == 422
    batch["items"] = [{"id": "one", "revision": 1}]
    assert browser.post("/api/v1/results/batch", json=batch).status_code == 409
    assert (
        browser.get(
            "/api/v1/results/page", params={"group": foreign_group["id"]}
        ).status_code
        == 404
    )
    assert (
        browser.put(
            "/api/v1/results/groups/" + foreign_group["id"],
            json={"name": "attack", "revision": 0},
        ).status_code
        == 404
    )
    assert (
        browser.delete(
            "/api/v1/results/groups/" + foreign_group["id"], params={"revision": 0}
        ).status_code
        == 404
    )
    assert (
        browser.put(
            "/api/results/update",
            params={"result_id": "other"},
            json={"description": "attack", "revision": 0},
        ).status_code
        == 404
    )
    assert browser.get("/api/v1/results/groups").json() == []
    assert (
        browser.get(
            "/api/v1/results/page", headers={"Origin": "https://attacker.example"}
        ).status_code
        == 403
    )
    assert (
        browser.post(
            "/api/v1/results/groups",
            json={"name": "attack"},
            headers={"Sec-Fetch-Site": "cross-site"},
        ).status_code
        == 403
    )


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 101},
        {"limit": 0},
        {"offset": -1},
        {"offset": 2**63},
        {"status": "invented"},
        {"query": "x" * 20_001},
        {"archived": "invalid"},
    ],
)
def test_page_api_rejects_invalid_parameters(history_api, params):
    _, browser = history_api
    assert browser.get("/api/v1/results/page", params=params).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"action": "archive", "items": []},
        {"action": "archive", "items": [{"id": "one", "revision": 0}] * 101},
        {"action": "unknown", "items": [{"id": "one", "revision": 0}]},
        {"action": "archive", "items": [{"id": "one", "revision": True}]},
        {"action": "archive", "items": [{"id": "one", "revision": -1}]},
        {
            "action": "archive",
            "items": [{"id": "one", "revision": 0}],
            "group_id": "unexpected",
        },
        {
            "action": "group",
            "items": [{"id": "one", "revision": 0}],
            "extra": "unexpected",
        },
    ],
)
def test_batch_api_rejects_invalid_payloads_without_writes(history_api, body):
    repository, browser = history_api
    before = import_api_job(repository)
    assert browser.post("/api/v1/results/batch", json=body).status_code == 422
    assert repository.get("one") == before


@pytest.mark.parametrize("name", ["", "   ", "x" * 129])
def test_group_api_rejects_invalid_names(history_api, name):
    repository, browser = history_api
    assert (
        browser.post("/api/v1/results/groups", json={"name": name}).status_code == 422
    )
    assert repository.list_groups("local_workspace") == []


def test_job_and_result_projections_prefer_metadata_title_without_changing_artifact(
    tmp_path,
):
    repository = JobRepository(tmp_path / "jobs.sqlite")
    job = import_api_job(repository)
    renamed = repository.edit_history(
        job["id"],
        owner="local_workspace",
        description="display",
        expected_revision=0,
    )
    view = job_response(renamed)
    assert view["description"] == "display"
    assert view["group_id"] is None
    assert view["history_revision"] == 1
    assert view["archived"] is False
    old_job = {
        key: value
        for key, value in job.items()
        if key not in {"history_title", "group_id", "history_revision", "archived"}
    }
    assert job_response(old_job)["description"] == "one"
    assert job_response(old_job)["history_revision"] == 0
    directory = tmp_path / job["id"]
    directory.mkdir()
    path = directory / "native-history.json"
    path.write_text(json.dumps(native_payload()), encoding="utf-8")
    before = path.read_bytes()
    result = route_result(
        renamed, artifacts=tmp_path, budget=SimpleNamespace(response_bytes=32 * 1024**2)
    )
    assert result["description"] == "display"
    assert result["history_revision"] == 1
    assert path.read_bytes() == before


@pytest.mark.parametrize(
    "url", ["/api/v1/results/page", "/api/results/list", "/api/v1/results/groups"]
)
def test_history_query_timeout_api_is_503_not_empty_success(
    history_api, monkeypatch, url
):
    repository, browser = history_api
    kept = import_api_job(repository)
    archived = import_api_job(repository, "archived")
    foreign = import_api_job(repository, "foreign", owner="other")
    repository.batch_history(
        "local_workspace",
        action="archive",
        items=[{"id": archived["id"], "revision": 0}],
    )
    group = repository.create_group("local_workspace", "Kept")
    before = [repository.get(item["id"]) for item in (kept, archived, foreign)]
    monkeypatch.setenv("X_SYNTH_HISTORY_QUERY_SECONDS", "0.02")
    repository.history = JobHistory(repository)
    connect = repository.connect

    @contextmanager
    def delayed_connection():
        with connect() as connection:

            def trace(sql):
                if sql.lstrip().startswith("SELECT"):
                    sleep(0.03)

            connection.set_trace_callback(trace)
            yield connection

    with monkeypatch.context() as scoped:
        scoped.setattr(repository, "connect", delayed_connection)
        response = browser.get(url)
    assert response.status_code == 503
    payload = response.json()
    assert payload["detail"]["code"] == "history_query_timeout"
    assert payload["detail"]["message"]
    assert "results" not in payload
    assert "total" not in payload
    assert payload != []
    assert [repository.get(item["id"]) for item in (kept, archived, foreign)] == before
    monkeypatch.delenv("X_SYNTH_HISTORY_QUERY_SECONDS")
    repository.history = JobHistory(repository)
    recovered = browser.get("/api/v1/results/page")
    assert recovered.status_code == 200
    assert recovered.json()["total"] == 1
    assert recovered.json()["results"][0]["result_id"] == kept["id"]
    assert recovered.json()["groups"] == [group]
    trash = browser.get("/api/v1/results/page", params={"archived": True})
    assert trash.status_code == 200
    assert trash.json()["results"][0]["result_id"] == archived["id"]


def test_history_query_sqlite_interrupt_reaches_api_as_503(history_api, monkeypatch):
    repository, browser = history_api
    with repository.connect() as connection:
        connection.executemany(
            """INSERT INTO jobs(id,owner,status,request,created,modified)
               VALUES (?,'local_workspace','legacy_completed',?,'2026-01-01','2026-01-01')""",
            [
                (
                    f"query-{index:04d}",
                    json.dumps({"smiles": "CCO", "description": f"sample {index}"}),
                )
                for index in range(160)
            ],
        )
        connection.commit()
    monkeypatch.setenv("X_SYNTH_HISTORY_QUERY_SECONDS", "0.02")
    repository.history = JobHistory(repository)
    connect = repository.connect
    native_codes = []

    @contextmanager
    def slow_connection():
        with connect() as connection:

            def casefold(value):
                sleep(0.001)
                return value.casefold() if isinstance(value, str) else ""

            connection.create_function(
                "history_casefold", 1, casefold, deterministic=True
            )
            try:
                yield connection
            except sqlite3.OperationalError as exc:
                native_codes.append(exc.sqlite_errorcode)
                raise

    with monkeypatch.context() as scoped:
        scoped.setattr(repository, "connect", slow_connection)
        response = browser.get(
            "/api/v1/results/page", params={"query": "no-match", "limit": 1}
        )
    assert native_codes == [sqlite3.SQLITE_INTERRUPT]
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "history_query_timeout"
    assert "results" not in response.json()
    assert repository.count("local_workspace") == 160
