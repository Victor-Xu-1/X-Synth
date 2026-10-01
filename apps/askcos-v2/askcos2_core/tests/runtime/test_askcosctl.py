from __future__ import annotations

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ASKCOSCTL = ROOT / "runtime" / "scripts" / "askcosctl.py"


def run_askcosctl(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(ASKCOSCTL), *args],
        cwd=ROOT,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def test_profiles_command_lists_runtime_profiles() -> None:
    result = run_askcosctl("profiles", "--json")

    assert result.returncode == 0, result.stderr
    profiles = json.loads(result.stdout)
    assert "core" in profiles
    assert "retro-basic" in profiles
    assert "route-tree" in profiles
    assert "auth" in profiles
    assert "full" in profiles


def test_plan_start_defaults_to_locked_full_stack() -> None:
    result = run_askcosctl("plan", "start", "--json")

    assert result.returncode == 0, result.stderr
    plan = json.loads(result.stdout)
    assert plan["profile"] == "full"
    assert plan["locked_runtime"] is True
    assert plan["target_service_count"] == 23
    assert len(plan["target_services"]) == 23
    assert plan["compose_profiles"] == ["--profile", "full"]


def test_plan_start_all_alias_uses_locked_full_stack() -> None:
    result = run_askcosctl("plan", "start", "all", "--json")

    assert result.returncode == 0, result.stderr
    plan = json.loads(result.stdout)
    assert plan["profile"] == "full"
    assert plan["locked_runtime"] is True
    assert "keycloak" in plan["target_services"]
    assert "mcts" in plan["target_services"]
    assert "retro_template_relevance" in plan["target_services"]


def test_partial_runtime_profiles_cannot_be_started() -> None:
    result = run_askcosctl("start", "retro-basic")

    assert result.returncode != 0
    assert "invalid choice" in result.stderr


def test_status_json_reads_real_compose_state() -> None:
    result = run_askcosctl("status", "--json")

    assert result.returncode == 0, result.stderr
    status = json.loads(result.stdout)
    assert status["manifest_service_count"] == 23
    assert isinstance(status["running_services"], list)
    expected_running = sorted(
        item["Service"]
        for item in status["compose_status"]
        if item.get("State") == "running"
    )
    assert status["running_services"] == expected_running
    assert status["running_count"] == len(expected_running)


def test_health_json_reports_full_stack_readiness() -> None:
    result = run_askcosctl("health", "--json")

    assert result.returncode == 0, result.stderr
    health = json.loads(result.stdout)

    assert health["profile"] == "full"
    assert health["locked_runtime"] is True
    assert health["manifest_service_count"] == 23
    assert health["service_count"] == 23
    assert isinstance(health["ready"], bool)
    assert isinstance(health["services"], dict)

    for service_name in ("app", "web", "retro_template_relevance", "scscore", "mcts"):
        service = health["services"][service_name]
        assert "running" in service
        assert "ready" in service
        assert "status" in service


def test_start_command_exposes_default_wait_controls() -> None:
    result = run_askcosctl("start", "--help")

    assert result.returncode == 0, result.stderr
    assert "--wait" in result.stdout
    assert "--no-wait" in result.stdout
    assert "--timeout" in result.stdout


def test_workspace_json_reports_project_layout() -> None:
    result = run_askcosctl("workspace", "--json")

    assert result.returncode == 0, result.stderr
    workspace = json.loads(result.stdout)
    assert workspace["project_root"].endswith("ASKCOSv2")
    assert workspace["core_root"].endswith("ASKCOSv2/askcos2_core")
    assert workspace["source_root_count"] >= 8

    roots = {item["key"]: item for item in workspace["roots"]}
    assert roots["core"]["exists"] is True
    assert roots["ui"]["exists"] is True
    assert roots["retro_models"]["exists"] is True


def test_doctor_json_reports_runtime_control_layer() -> None:
    result = run_askcosctl("doctor", "--json")

    assert result.returncode == 0, result.stderr
    doctor = json.loads(result.stdout)
    checks = {item["name"]: item for item in doctor["checks"]}

    assert doctor["summary"]["errors"] == 0
    assert doctor["summary"]["unmanaged_top_level_directories"] == 0
    assert checks["compose_file"]["status"] == "ok"
    assert checks["services_manifest"]["status"] == "ok"
    assert checks["workspace_manifest"]["status"] == "ok"
    assert checks["top_level_windows_wrapper"]["status"] == "ok"
    assert checks["top_level_powershell_wrapper"]["status"] == "ok"
    assert checks["top_level_shell_wrapper"]["status"] == "ok"


def test_repo_status_json_summarizes_managed_git_roots() -> None:
    result = run_askcosctl("repo-status", "--json")

    assert result.returncode == 0, result.stderr
    status = json.loads(result.stdout)

    assert status["project_root"].endswith("ASKCOSv2")
    assert status["git_root_count"] >= 2
    assert status["dirty_root_count"] >= 0
    assert isinstance(status["roots"], list)

    roots = {item["key"]: item for item in status["roots"]}
    assert roots["core"]["path"] == "askcos2_core"
    assert roots["core"]["git"] is True
    assert isinstance(roots["core"]["dirty"], bool)
    assert isinstance(roots["core"]["status_counts"], dict)
    assert "sample" in roots["core"]


def test_plan_clean_reports_existing_generated_artifacts_without_deleting() -> None:
    result = run_askcosctl("plan", "clean", "--json")

    assert result.returncode == 0, result.stderr
    plan = json.loads(result.stdout)

    assert plan["project_root"].endswith("ASKCOSv2")
    assert plan["action"] == "clean"
    assert plan["delete_count"] >= 0
    assert isinstance(plan["artifacts"], list)

    for artifact in plan["artifacts"]:
        assert artifact["path"]
        assert "exists" in artifact
        assert "delete" in artifact
        assert artifact["delete"] is artifact["exists"]
