from fastapi.testclient import TestClient

from apps.api.app import create_app


def client(app):
    return TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 1234))


def test_real_api_history_uses_transactional_repository_and_rejects_cross_site(
    tmp_path,
):
    application = create_app(jobs_root=tmp_path)
    application.state.repository.create("local_workspace", {"smiles": "CCO"})
    application.state.repository.create("other_user", {"smiles": "CCN"})
    browser = client(application)
    response = browser.get("/api/v1/unified-route/jobs")
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["jobs"][0]["target_smiles"] == "CCO"
    assert (
        browser.get(
            "/api/v1/unified-route/jobs", headers={"Origin": "https://attacker.example"}
        ).status_code
        == 403
    )
    assert (
        browser.get(
            "/api/v1/unified-route/jobs", headers={"Origin": "http://localhost:9999"}
        ).status_code
        == 403
    )
    assert (
        browser.get(
            "/api/v1/unified-route/jobs", headers={"Host": "attacker.example"}
        ).status_code
        == 403
    )


def test_client_cannot_read_other_tasks_or_bypass_product_search(tmp_path):
    application = create_app(jobs_root=tmp_path)
    foreign = application.state.repository.create("other_user", {"smiles": "CCN"})
    browser = client(application)
    assert browser.get(f"/api/v1/unified-route/jobs/{foreign['id']}").status_code == 404
    assert (
        browser.post(
            "/api/tree-search/mcts/call-async", json={"smiles": "CCO"}
        ).status_code
        == 409
    )
    assert (
        browser.post(
            "/api/v1/unified-route/call-async",
            json={"smiles": "CCO", "external_stock_paths": ["/etc/passwd"]},
        ).status_code
        == 422
    )


def test_session_and_template_routes_share_the_server_security_boundary(tmp_path):
    browser = client(create_app(jobs_root=tmp_path))
    assert browser.get("/api/v1/session").json() == {
        "mode": "local",
        "owner": "local_workspace",
        "administrator": True,
        "workspace_access": True,
    }
    for endpoint in ("/api/v1/session", "/api/v1/template-library/health"):
        assert (
            browser.get(
                endpoint, headers={"Origin": "https://attacker.example"}
            ).status_code
            == 403
        )
    assert (
        browser.post(
            "/api/v1/template-library/query",
            json={},
            headers={"Sec-Fetch-Site": "cross-site"},
        ).status_code
        == 403
    )
    assert browser.get("/api/v1/template-library/health").status_code == 503


def test_history_edits_are_owned_transactional_and_non_destructive(tmp_path):
    application = create_app(jobs_root=tmp_path)
    repository = application.state.repository
    repository.import_history(
        identifier="a" * 32,
        owner="local_workspace",
        request={"smiles": "CCO"},
        summary={"origin": "askcos_history"},
        created="2026-01-01",
        modified="2026-01-01",
        completed=True,
    )
    browser = client(application)
    url = "/api/results/update?result_id=" + "a" * 32
    assert (
        browser.put(url, json={"description": "renamed", "revision": 0}).status_code
        == 200
    )
    assert "description" not in repository.get("a" * 32)["request"]
    assert repository.get("a" * 32)["history_title"] == "renamed"
    assert (
        browser.put(
            url, json={"description": "stale", "revision": 0, "history_revision": 0}
        ).status_code
        == 409
    )
    assert (
        browser.delete("/api/results/destroy?result_id=" + "a" * 32).status_code == 200
    )
    assert repository.count("local_workspace") == 0
    assert repository.get("a" * 32)["status"] == "legacy_completed"
    assert repository.get("a" * 32)["archived"] == 1
    active = repository.create("local_workspace", {"smiles": "CCN"})
    assert (
        browser.delete("/api/results/destroy?result_id=" + active["id"]).status_code
        == 409
    )
    assert browser.delete("/api/results/destroy?result_id=foreign").status_code == 404
