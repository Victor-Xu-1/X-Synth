from pathlib import Path

import yaml


COMPOSE_PATH = Path(__file__).resolve().parents[1] / "compose.yaml"
NGINX_PATH = Path(__file__).resolve().parents[1] / "nginx.conf"
TEMPLATE_RELEVANCE_START = (
    Path(__file__).resolve().parents[2]
    / "retro"
    / "template_relevance"
    / "scripts"
    / "start_torchserve.sh"
)
CONDA_PYTHON = "/opt/conda/bin/python"


def _compose_services():
    with COMPOSE_PATH.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)["services"]


def test_model_service_healthchecks_use_available_python_interpreter():
    services = _compose_services()
    service_names = [
        "retro_template_relevance",
        "fast_filter",
        "scscore",
        "atom_map_rxnmapper",
        "pathway_ranker",
        "expand_one",
    ]

    for service_name in service_names:
        healthcheck = services[service_name]["healthcheck"]["test"]
        command = " ".join(healthcheck)
        assert CONDA_PYTHON in command
        assert "CMD-SHELL python -c" not in command


def test_retro_star_and_value_network_are_compose_managed():
    services = _compose_services()

    assert "value_network" in services
    assert "retro_star" in services
    assert services["value_network"]["healthcheck"]["test"][0] == "CMD-SHELL"
    assert services["retro_star"]["healthcheck"]["test"][0] == "CMD-SHELL"


def test_evidence_and_condition_services_are_compose_managed():
    services = _compose_services()
    service_names = [
        "retro_exact_match",
        "retro_retrosim",
        "context_recommender",
        "context_quarc",
    ]

    for service_name in service_names:
        assert service_name in services
        healthcheck = services[service_name]["healthcheck"]["test"]
        command = " ".join(healthcheck)
        assert CONDA_PYTHON in command


def test_retro_database_services_can_call_gateway_from_container_runtime():
    services = _compose_services()

    for service_name in ["retro_exact_match", "retro_retrosim"]:
        service = services[service_name]
        assert service["env_file"] == [".env"]
        assert service["network_mode"] == "host"
        assert service.get("ports") in (None, [])


def test_template_relevance_starts_only_route_models_by_default():
    script = TEMPLATE_RELEVANCE_START.read_text(encoding="utf-8")

    assert "TEMPLATE_RELEVANCE_MODELS" in script
    assert "reaxys=reaxys.mar" in script
    assert "pistachio=pistachio.mar" in script
    assert "uspto_higher_level=uspto_higher_level.mar" in script
    assert "cas=cas.mar" not in script
    assert "bkms_metabolic=bkms_metabolic.mar" not in script


def test_web_frontend_only_listens_on_8769():
    services = _compose_services()
    nginx_config = NGINX_PATH.read_text(encoding="utf-8")

    assert services["web"].get("ports") in (None, [])
    assert "listen 8769;" in nginx_config
    assert "listen 80;" not in nginx_config
    assert "listen 443;" not in nginx_config


def test_keycloak_locale_config_runs_after_keycloak_is_healthy():
    services = _compose_services()
    service = services["keycloak_locale_config"]

    assert service["profiles"] == ["auth", "full"]
    assert service["depends_on"]["keycloak"]["condition"] == "service_healthy"
    assert service["environment"]["KEYCLOAK_ADMIN_LOCALE"] == "zh-CN"
    assert service["command"] == "/opt/conda/bin/python scripts/configure_keycloak_locale.py"
