from pathlib import Path
import shutil

from fastapi.testclient import TestClient

from apps.api.app import create_app

ROOT = Path(__file__).resolve().parents[2]


def test_product_host_serves_real_workbench_source_and_spa_navigation(tmp_path, monkeypatch):
    web = tmp_path / "web"
    web.mkdir()
    shutil.copy2(ROOT / "apps/web/index.html", web / "index.html")
    monkeypatch.setenv("X_SYNTH_WEB_DIST", str(web))
    monkeypatch.delenv("X_SYNTH_STOCK_INDEX", raising=False)
    app = create_app(jobs_root=tmp_path / "state")
    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000)) as client:
        assert client.get("/").status_code == 200
        assert client.get("/results").text == client.get("/").text
        assert client.get("/results/actual-job").text == client.get("/").text
        assert client.get("/editor/actual-document").text == client.get("/").text
        assert client.get("/api/v1/health").headers["content-type"].startswith("application/json")


def test_missing_assets_and_unknown_api_paths_are_not_disguised_as_html(tmp_path, monkeypatch):
    web = tmp_path / "web"
    web.mkdir()
    shutil.copy2(ROOT / "apps/web/index.html", web / "index.html")
    monkeypatch.setenv("X_SYNTH_WEB_DIST", str(web))
    app = create_app(jobs_root=tmp_path / "state")
    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000)) as client:
        assert client.get("/assets/missing.js").status_code == 404
        assert client.get("/api/not-a-capability").status_code == 404


def test_development_proxy_has_the_same_product_api_authority():
    config = (ROOT / "apps/web/vite.config.js").read_text()
    assert '"/api/": productApiPtr' in config
    assert "VITE_X_SYNTH_API_TARGET" in config
    assert "127.0.0.1:9100" not in config
