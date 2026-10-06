"""Real loopback HTTP, local authentication, SQLite and captured route evidence."""

import json
import socket
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path
from threading import Barrier, Thread
from time import monotonic, sleep
from types import SimpleNamespace

import httpx
import pytest
import uvicorn

from packages.route_pool.askcos import normalize_askcos_tree_result
from packages.workspace.route_graph import RouteGraph


def document_body():
    return {
        "title": "Owned route",
        "graph": {
            "target_id": "target",
            "edges": [],
            "nodes": [
                {"id": "target", "type": "molecule", "smiles": "OCC"},
            ],
        },
    }


def test_cross_site_is_rejected_before_expensive_graph_validation(api):
    body = document_body()
    body["graph"]["nodes"][0]["smiles"] = "invalid_molecule"
    response = api.client.post(
        "/api/v1/route-documents",
        json=body,
        headers={"Origin": "https://untrusted.example"},
    )
    assert response.status_code == 403
    assert api.app.state.documents.list("local_workspace") == []


def test_material_scope_is_enforced_for_independent_document_http(api):
    body = document_body()
    body["graph"]["nodes"][0]["smiles"] = "CN(CCCl)CCCl"
    response = api.client.post("/api/v1/route-documents", json=body)
    assert response.status_code == 422
    assert api.app.state.documents.list("local_workspace") == []

    # Preserve historical evidence privately; do not republish its old claims.
    graph = RouteGraph.model_validate(
        body["graph"], context={"allow_archival_scope": True}
    )
    identifier = "d" * 32
    source = {"signature": graph.semantic_signature(), "closed": True}
    with api.app.state.documents.connect() as connection:
        connection.execute(
            "INSERT INTO route_documents VALUES(?,?,?,?,?,?,?,?)",
            (identifier, "local_workspace", "Archived evidence",
             graph.model_dump_json(), json.dumps(source), 0,
             "2026-01-01", "2026-01-01"),
        )
        connection.commit()
    response = api.client.get(f"/api/v1/route-documents/{identifier}")
    assert response.status_code == 409
    assert "graph" not in response.json() and "source_closed" not in response.json()
    with api.app.state.documents.connect() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM route_documents WHERE id=?", (identifier,)
        ).fetchone()[0] == 1


@pytest.fixture
def api(tmp_path, monkeypatch, request):
    monkeypatch.setenv("X_SYNTH_STATE_DIR", str(tmp_path / "import-state"))
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "local")
    for name in (
        "X_SYNTH_STOCK_INDEX",
        "X_SYNTH_WEB_DIST",
        "X_SYNTH_ALLOWED_ORIGINS",
        "X_SYNTH_MAX_STRUCTURE_ATOMS",
        "X_SYNTH_REQUEST_BYTES",
    ):
        monkeypatch.delenv(name, raising=False)
    for name, value in getattr(request, "param", {}).items():
        monkeypatch.setenv(name, value)
    # app.py has a module-level factory: import only after isolating all state.
    from apps.api.app import create_app

    application = create_app(jobs_root=tmp_path / "state")
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(
        uvicorn.Config(application, log_level="warning", access_log=False)
    )
    thread = Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    try:
        deadline = monotonic() + 10
        while not server.started and thread.is_alive() and monotonic() < deadline:
            sleep(0.01)
        assert server.started, "Isolated HTTP server did not start"
        with httpx.Client(
            base_url=f"http://127.0.0.1:{sock.getsockname()[1]}", timeout=10
        ) as client:
            yield SimpleNamespace(
                client=client, app=application, root=tmp_path / "state"
            )
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        sock.close()
        assert not thread.is_alive(), "Isolated HTTP server did not stop"


def captured_task(api, *, owner="local_workspace"):
    fixture = Path("tests/fixtures/askcos/diphenhydramine_retrostar_result.json")
    payload = json.loads(fixture.read_text())
    candidates = normalize_askcos_tree_result(payload, engine="askcos_retro_star")
    assert candidates
    job = api.app.state.repository.create(
        owner,
        {
            "smiles": candidates[0].target_smiles,
            "description": "Captured schema evidence",
        },
    )
    # Captured pre-publication-protocol results retain explicit legacy readability.
    with api.app.state.repository.connect() as connection:
        connection.execute("UPDATE jobs SET checkpoint='{}' WHERE id=?", (job["id"],))
        connection.commit()
    job = api.app.state.repository.get(job["id"])
    artifact = api.root / "routes" / job["id"] / "selected_routes.json"
    artifact.parent.mkdir(parents=True)
    artifact.write_text(json.dumps([asdict(value) for value in candidates]))
    return job, artifact, candidates


def test_editable_copy_uses_display_title_without_rewriting_scientific_request(api):
    job, _, candidates = captured_task(api)
    repository = api.app.state.repository
    repository.edit_history(
        job["id"],
        owner="local_workspace",
        description="Renamed study",
        expected_revision=job["revision"],
    )
    response = api.client.post(
        "/api/v1/route-documents/from-task",
        json={"job_id": job["id"], "route_index": 0},
    )
    assert response.status_code == 200
    assert response.json()["title"].startswith("Renamed study")
    assert response.json()["source"]["route_id"] == candidates[0].route_id
    assert (
        repository.get(job["id"])["request"]["description"]
        == "Captured schema evidence"
    )


def test_http_crud_has_stable_fields_canonicalization_revisions_and_true_deletion(api):
    client = api.client
    response = client.post("/api/v1/route-documents", json=document_body())
    assert response.status_code == 200
    saved = response.json()
    assert set(saved) == {
        "id",
        "title",
        "graph",
        "revision",
        "created",
        "modified",
        "target_smiles",
        "state",
        "source",
        "prediction_scores",
        "source_closed",
    }
    assert saved["target_smiles"] == "CCO"
    assert saved["state"] == "draft" and saved["revision"] == 0
    assert saved["source"] == saved["prediction_scores"] == {}
    assert saved["source_closed"] is False
    url = f"/api/v1/route-documents/{saved['id']}"
    assert client.get(url).json() == saved
    body = {"title": "Renamed", "graph": saved["graph"], "revision": 0}
    updated = client.put(url, json=body)
    assert updated.status_code == 200
    assert updated.json()["revision"] == 1
    assert client.put(url, json=body).status_code == 409
    assert client.get(url).json() == updated.json()
    rows = client.get("/api/v1/route-documents").json()
    assert len(rows) == 1 and rows[0]["node_count"] == 1
    assert "graph" not in rows[0] and "source" not in rows[0]
    assert client.delete(url).json() == {"deleted": True}
    assert client.get(url).status_code == client.delete(url).status_code == 404
    assert client.get("/api/v1/route-documents").json() == []
    with api.app.state.documents.connect() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM route_documents").fetchone()[0]
            == 0
        )


@pytest.mark.parametrize(
    "field,value",
    [
        ("owner", "other"),
        ("source", {"closed": True}),
        ("prediction_scores", {"r-1": 1}),
        ("source_closed", True),
        ("state", "source_copy"),
        ("revision", 1),
    ],
)
def test_http_clients_cannot_spoof_server_owned_document_fields(api, field, value):
    client = api.client
    body = document_body()
    body[field] = value
    assert client.post("/api/v1/route-documents", json=body).status_code == 422
    assert client.get("/api/v1/route-documents").json() == []
    saved = client.post("/api/v1/route-documents", json=document_body()).json()
    url = f"/api/v1/route-documents/{saved['id']}"
    if field != "revision":
        body["revision"] = 0
        assert client.put(url, json=body).status_code == 422
        assert client.get(url).json() == saved


def test_http_foreign_documents_and_tasks_are_never_visible_or_mutable(api):
    documents = api.app.state.documents
    foreign = documents.create(
        "foreign", "Private", RouteGraph.model_validate(document_body()["graph"])
    )
    url = f"/api/v1/route-documents/{foreign['id']}"
    assert api.client.get(url).status_code == 404
    assert (
        api.client.put(url, json=document_body() | {"revision": 0}).status_code == 404
    )
    assert api.client.delete(url).status_code == 404
    assert api.client.get("/api/v1/route-documents").json() == []
    assert documents.get(foreign["id"], "foreign") == foreign
    job, artifact, _ = captured_task(api, owner="foreign")
    before = artifact.read_bytes()
    assert (
        api.client.post(
            "/api/v1/route-documents/from-task",
            json={"job_id": job["id"], "route_index": 0},
        ).status_code
        == 404
    )
    assert artifact.read_bytes() == before


def test_http_from_task_uses_captured_evidence_without_modifying_task_or_scores(api):
    job, artifact, candidates = captured_task(api)
    before = artifact.read_bytes()
    response = api.client.post(
        "/api/v1/route-documents/from-task",
        json={"job_id": job["id"], "route_index": 0},
    )
    assert response.status_code == 200
    saved = response.json()
    assert saved["state"] == "source_copy"
    assert saved["source"] == {
        "engine": "askcos_retro_star",
        "route_id": candidates[0].route_id,
        "job_id": job["id"],
        "route_index": 0,
    }
    assert saved["source_closed"] == candidates[0].closed
    expected_scores = {
        f"r-{i + 1}": step.confidence
        for i, step in enumerate(candidates[0].steps)
        if step.confidence is not None and 0 <= step.confidence <= 1
    }
    assert saved["prediction_scores"] == expected_scores
    assert set(expected_scores) <= {
        node["id"] for node in saved["graph"]["nodes"] if node["type"] == "reaction"
    }
    molecules = {
        node["smiles"] for node in saved["graph"]["nodes"] if node["type"] == "molecule"
    }
    assert set(candidates[0].starting_materials) <= molecules
    url = f"/api/v1/route-documents/{saved['id']}"
    original_graph = json.loads(json.dumps(saved["graph"]))
    saved["graph"]["nodes"][0]["note"] = "Annotation only"
    saved["graph"]["nodes"][0]["position"] = {"x": 280, "y": -50}
    saved = api.client.put(
        url, json={"title": "Annotated", "graph": saved["graph"], "revision": 0}
    ).json()
    assert (
        saved["prediction_scores"] == expected_scores
        and saved["state"] == "source_copy"
    )
    loaded = api.client.get(url).json()
    assert loaded == saved and loaded["source_closed"] == candidates[0].closed
    assert loaded["graph"]["nodes"][0]["position"] == {"x": 280, "y": -50}
    assert loaded["graph"]["nodes"][0]["note"] == "Annotation only"
    for node in saved["graph"]["nodes"]:
        if node["id"] == saved["graph"]["target_id"]:
            node["smiles"] = "CCO"
    changed = api.client.put(
        url, json={"title": "Chemistry edited", "graph": saved["graph"], "revision": 1}
    ).json()
    assert changed["state"] == "draft" and changed["prediction_scores"] == {}
    assert changed["source_closed"] is False and changed["source"] == saved["source"]
    restored = api.client.put(
        url,
        json={"title": "Chemistry restored", "graph": original_graph, "revision": 2},
    ).json()
    assert (
        restored["state"] == "draft"
        and restored["prediction_scores"] == {}
        and restored["source_closed"] is False
    )
    assert api.client.get(url).json() == restored
    assert artifact.read_bytes() == before
    assert api.app.state.repository.get(job["id"], owner="local_workspace") == job


@pytest.mark.parametrize(
    "content",
    [
        "broken json",
        "null",
        "{}",
        '"not a list"',
        "[{}]",
        '[{"target_smiles":"[CH5]"}]',
        '[{"target_smiles":"CCO","steps":null}]',
    ],
)
def test_http_bad_task_artifacts_fail_cleanly_before_document_creation(api, content):
    job = api.app.state.repository.create("local_workspace", {"smiles": "CCO"})
    artifact = api.root / "routes" / job["id"] / "selected_routes.json"
    artifact.parent.mkdir(parents=True)
    artifact.write_text(content)
    response = api.client.post(
        "/api/v1/route-documents/from-task",
        json={"job_id": job["id"], "route_index": 0},
    )
    assert response.status_code == 409
    assert api.client.get("/api/v1/route-documents").json() == []
    assert artifact.read_text() == content


def test_http_unavailable_task_or_route_cannot_be_imported(api):
    assert (
        api.client.post(
            "/api/v1/route-documents/from-task",
            json={"job_id": "f" * 32, "route_index": 0},
        ).status_code
        == 404
    )
    job = api.app.state.repository.create("local_workspace", {"smiles": "CCO"})
    assert (
        api.client.post(
            "/api/v1/route-documents/from-task",
            json={"job_id": job["id"], "route_index": 0},
        ).status_code
        == 409
    )


@pytest.mark.parametrize("revision", [True, False, "0", 0.0, -1])
def test_http_revision_is_not_coerced_and_rejections_are_non_mutating(api, revision):
    saved = api.client.post("/api/v1/route-documents", json=document_body()).json()
    url = f"/api/v1/route-documents/{saved['id']}"
    assert (
        api.client.put(url, json=document_body() | {"revision": revision}).status_code
        == 422
    )
    assert api.client.get(url).json() == saved


@pytest.mark.parametrize("query", ["limit=0", "limit=-1", "limit=101", "offset=-1"])
def test_http_document_pages_are_bounded(api, query):
    assert api.client.get(f"/api/v1/route-documents?{query}").status_code == 422


@pytest.mark.parametrize(
    "smiles",
    [
        "not_smiles",
        "[CH5]",
        " ",
        "CCO name",
        "CCO |atomProp:0.label.text|",
        "C" * 8193,
        "C" * 1025,
    ],
)
def test_http_structure_validation_rejects_invalid_or_excessive_inputs(api, smiles):
    assert (
        api.client.post(
            "/api/v1/structure/validate", json={"smiles": smiles}
        ).status_code
        == 422
    )
    body = document_body()
    body["graph"]["nodes"][0]["smiles"] = smiles
    assert api.client.post("/api/v1/route-documents", json=body).status_code == 422
    assert api.client.get("/api/v1/route-documents").json() == []


@pytest.mark.parametrize("api", [{"X_SYNTH_MAX_STRUCTURE_ATOMS": "2"}], indirect=True)
def test_http_routes_obey_the_same_configured_atom_budget(api):
    assert api.client.post(
        "/api/v1/structure/validate", json={"smiles": "CC"}
    ).json() == {"smiles": "CC", "atoms": 2, "valid": True}
    assert (
        api.client.post(
            "/api/v1/structure/validate", json={"smiles": "CCO"}
        ).status_code
        == 422
    )
    assert (
        api.client.post("/api/v1/route-documents", json=document_body()).status_code
        == 422
    )


def test_http_structure_is_canonical_and_strictly_schema_validated(api):
    assert api.client.post(
        "/api/v1/structure/validate", json={"smiles": " OCC "}
    ).json() == {"smiles": "CCO", "atoms": 3, "valid": True}
    assert (
        api.client.post(
            "/api/v1/structure/validate", json={"smiles": "CCO", "valid": True}
        ).status_code
        == 422
    )
    assert (
        api.client.post("/api/v1/structure/validate", json={"smiles": 123}).status_code
        == 422
    )


@pytest.mark.parametrize("api", [{"X_SYNTH_REQUEST_BYTES": "512"}], indirect=True)
def test_http_request_budget_rejects_sized_and_chunked_payloads(api):
    body = json.dumps({"smiles": "C" * 600}).encode()
    for content in (body, iter([body[:300], body[300:]])):
        response = api.client.post(
            "/api/v1/structure/validate",
            content=content,
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 413
    assert api.client.get("/api/v1/route-documents").json() == []


def test_http_cross_site_requests_and_missing_shared_identity_are_rejected(
    api, monkeypatch
):
    requests = [
        ("GET", "/api/v1/route-documents", None),
        ("POST", "/api/v1/route-documents", document_body()),
        (
            "POST",
            "/api/v1/route-documents/from-task",
            {"job_id": "a" * 32, "route_index": 0},
        ),
        ("POST", "/api/v1/structure/validate", {"smiles": "CCO"}),
    ]
    for method, url, body in requests:
        assert (
            api.client.request(
                method, url, json=body, headers={"Origin": "https://attacker.example"}
            ).status_code
            == 403
        )
        assert (
            api.client.request(
                method, url, json=body, headers={"Host": "attacker.example"}
            ).status_code
            == 403
        )
        assert (
            api.client.request(
                method, url, json=body, headers={"Sec-Fetch-Site": "cross-site"}
            ).status_code
            == 403
        )
    monkeypatch.setenv("X_SYNTH_AUTH_MODE", "askcos")
    for method, url, body in requests:
        assert api.client.request(method, url, json=body).status_code == 401


def test_http_concurrent_writes_return_one_success_and_one_conflict(api):
    saved = api.client.post("/api/v1/route-documents", json=document_body()).json()
    barrier = Barrier(2)

    def write(title):
        barrier.wait(timeout=5)
        return api.client.put(
            f"/api/v1/route-documents/{saved['id']}",
            json={"title": title, "graph": saved["graph"], "revision": 0},
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(write, ["First", "Second"]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    (winner,) = [
        response.json() for response in responses if response.status_code == 200
    ]
    assert api.client.get(f"/api/v1/route-documents/{saved['id']}").json() == winner


@pytest.mark.parametrize(
    "kind",
    [
        "unknown_graph",
        "unknown_node",
        "invalid_target",
        "invalid_position",
        "unknown_edge",
    ],
)
def test_http_invalid_graph_schema_never_creates_or_mutates_a_document(api, kind):
    saved = api.client.post("/api/v1/route-documents", json=document_body()).json()
    url = f"/api/v1/route-documents/{saved['id']}"
    body = document_body()
    if kind == "unknown_graph":
        body["graph"]["schema_version"] = 99
    elif kind == "unknown_node":
        body["graph"]["nodes"][0]["confidence"] = 1
    elif kind == "invalid_target":
        body["graph"]["target_id"] = "absent"
    elif kind == "invalid_position":
        body["graph"]["nodes"][0]["position"] = {"x": 100001, "y": 0}
    else:
        body["graph"]["edges"] = [
            {"id": "e", "source": "target", "target": "target", "score": 1}
        ]
    assert api.client.post("/api/v1/route-documents", json=body).status_code == 422
    assert api.client.put(url, json=body | {"revision": 0}).status_code == 422
    assert api.client.get(url).json() == saved
    assert len(api.client.get("/api/v1/route-documents").json()) == 1


@pytest.mark.parametrize("value", [True, 0.0, "0", -1, 10])
def test_http_from_task_index_is_strict_and_bounded(api, value):
    assert (
        api.client.post(
            "/api/v1/route-documents/from-task",
            json={"job_id": "a" * 32, "route_index": value},
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    "url,body",
    [
        (
            "/api/v1/route-documents",
            '{"title":"Invalid","graph":{"target_id":"target","nodes":[{"id":"target","type":"molecule","smiles":"CCO","position":{"x":1e999,"y":0}}]}}',
        ),
        ("/api/v1/structure/validate", '{"smiles":1e999}'),
    ],
)
def test_http_nonfinite_json_is_rejected_without_storage_mutation(api, url, body):
    response = api.client.post(
        url, content=body, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
    assert api.client.get("/api/v1/route-documents").json() == []


def test_http_unsupported_storage_schema_is_non_mutating_and_returns_service_unavailable(
    api,
):
    saved = api.client.post("/api/v1/route-documents", json=document_body()).json()
    with api.app.state.documents.connect() as connection:
        connection.execute("UPDATE route_document_schema SET version=2")
        connection.commit()
    before = api.app.state.documents.path.read_bytes()
    url = f"/api/v1/route-documents/{saved['id']}"
    for response in [
        api.client.get(url),
        api.client.delete(url),
        api.client.put(url, json=document_body() | {"revision": 0}),
        api.client.post("/api/v1/route-documents", json=document_body()),
        api.client.get("/api/v1/route-documents"),
    ]:
        assert response.status_code == 503
    assert api.app.state.documents.path.read_bytes() == before
