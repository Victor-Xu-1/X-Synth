from pathlib import Path


def test_start_synon_workbench_script_manages_orchestrator_health():
    script = Path("scripts/operations/start_synon_workbench.sh")

    assert script.is_file()
    text = script.read_text(encoding="utf-8")
    assert "docker compose -p synonrt --profile route-tree up -d" in text
    assert "run_synon_orchestrator_supervisor.sh" in text
    assert "supervisor.pid" in text
    assert "pgrep -f" in text
    assert "http://127.0.0.1:8790/synon-api/health" in text
    assert "SYNON_ORCHESTRATOR_FORCE_RESTART" in text
    assert "SYNON_ORCHESTRATOR_START_TIMEOUT_SECONDS" in text
    assert "SYNON_LOCAL_IMAGE_BUILD_TIMEOUT_SECONDS" in text
    assert "docker compose -p synonrt build app celery_workers web" in text
    assert "SYNON_DOCKER_CONFIG_DIR" in text
    assert "SYNON_DOCKER_CONTEXT_NAME" in text
    assert "prepare_project_docker_context" in text
    assert 'export DOCKER_CONFIG="$DOCKER_CONFIG_DIR"' in text
    assert 'docker context create "$DOCKER_CONTEXT_NAME"' in text
    assert 'docker context use "$DOCKER_CONTEXT_NAME"' in text
    assert "docker info" in text
    assert text.count('curl --noproxy "*"') == 3
    assert "SYNON_VERIFY_ASKCOS_STOCK" in text
    assert "SYNON_ASKCOS_MIN_BUYABLES_COUNT" in text
    assert "import_askcos_buyables_mongo.sh" in text
    assert "SYNON_AUTO_RESUME_INTERRUPTED_JOBS" in text
    assert "orchestrator_deadline" in text
    assert "seq 1 30" not in text
    assert "SYNON_ONLINE_SUPPLIERS" in text


def test_start_synon_workbench_does_not_use_smoke_stock_as_real_default():
    script = Path("scripts/operations/start_synon_workbench.sh")

    assert script.is_file()
    text = script.read_text(encoding="utf-8")
    assert "tests/real-cases/data-compiler-smoke/domestic_stock" not in text


def test_synon_orchestrator_supervisor_restarts_uvicorn():
    script = Path("scripts/operations/run_synon_orchestrator_supervisor.sh")

    assert script.is_file()
    text = script.read_text(encoding="utf-8")
    assert "while true" in text
    assert "apps.synon_orchestrator.app:app" in text
    assert "exit_code=$?" in text
    assert "restarting in" in text


def test_tree_search_controller_worker_runs_single_heavy_task_for_stability():
    script = Path("apps/askcos-v2/askcos2_core/scripts/start_celery_workers.sh")

    assert script.is_file()
    text = script.read_text(encoding="utf-8")
    assert "start_worker 1 tree_search_worker" in text
