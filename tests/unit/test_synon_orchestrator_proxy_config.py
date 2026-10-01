from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_runtime_nginx_proxies_synon_api_to_host_orchestrator():
    config = (REPO_ROOT / "apps/askcos-v2/askcos2_core/nginx.conf").read_text()

    assert "location /synon-api/" in config
    assert "proxy_pass http://host.docker.internal:8790" in config
    assert "proxy_read_timeout 7200" in config


def test_image_nginx_proxies_synon_api_to_host_orchestrator():
    config = (
        REPO_ROOT
        / "apps/askcos-v2/askcos-vue-nginx/askcos_vue/nginx.conf"
    ).read_text()

    assert "location /synon-api/" in config
    assert "proxy_pass http://host.docker.internal:8790" in config
    assert "proxy_read_timeout 7200" in config


def test_vite_dev_server_proxies_synon_api_to_local_orchestrator():
    config = (
        REPO_ROOT
        / "apps/askcos-v2/askcos-vue-nginx/askcos_vue/vite.config.js"
    ).read_text()

    assert '"/synon-api/": synonOrchestratorPtr' in config
    assert "VITE_SYNON_ORCHESTRATOR_TARGET" in config
    assert "http://127.0.0.1:8790" in config
