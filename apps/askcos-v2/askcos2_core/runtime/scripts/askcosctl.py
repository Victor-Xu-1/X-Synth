#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
import ssl
import urllib.error
import urllib.request

import yaml


ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = ROOT.parent
MANIFEST = ROOT / "runtime" / "manifests" / "services.yaml"
WORKSPACE_MANIFEST = ROOT / "runtime" / "manifests" / "workspace.yaml"
ALL_PROFILE_ARGS = ["--profile", "full"]
LOCKED_RUNTIME_PROFILE = "full"
LOCKED_RUNTIME_CHOICES = ["full", "all"]
DEFAULT_COMMAND_TIMEOUT_SECONDS = 120


def run(
    command: list[str],
    *,
    check: bool = True,
    timeout: int = DEFAULT_COMMAND_TIMEOUT_SECONDS,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            cwd=ROOT,
            check=check,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        return subprocess.CompletedProcess(
            args=command,
            returncode=124,
            stdout=exc.stdout or "",
            stderr=f"Command timed out after {timeout}s: {' '.join(command)}",
        )


def load_manifest() -> dict[str, Any]:
    with MANIFEST.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def load_workspace_manifest() -> dict[str, Any]:
    with WORKSPACE_MANIFEST.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def project_path(relative_path: str) -> Path:
    return (PROJECT_ROOT / relative_path).resolve()


def path_payload(relative_path: str) -> dict[str, Any]:
    absolute_path = project_path(relative_path)
    return {
        "path": relative_path,
        "absolute_path": absolute_path.as_posix(),
        "exists": absolute_path.exists(),
    }


def profile_names() -> list[str]:
    return list(load_manifest()["profiles"])


def normalize_locked_runtime_profile(profile: str | None) -> str:
    if profile in (None, "full", "all"):
        return LOCKED_RUNTIME_PROFILE
    raise SystemExit(
        "ASKCOS runtime is locked to the full backend stack; use 'start', "
        "'start full', or 'start all'."
    )


def services_for_profile(profile: str) -> list[str]:
    manifest = load_manifest()
    if profile not in manifest["profiles"]:
        raise SystemExit(f"Unknown profile: {profile}")
    services = manifest["services"]
    return sorted(
        name
        for name, service in services.items()
        if profile in service.get("profiles", [])
        or "core" in service.get("profiles", [])
    )


def compose_profiles(profile: str) -> list[str]:
    if profile == "core":
        return []
    return ["--profile", profile]


def start_plan(profile: str | None = None) -> dict[str, Any]:
    profile = normalize_locked_runtime_profile(profile)
    target = services_for_profile(profile)
    running = running_services()
    return {
        "profile": profile,
        "locked_runtime": True,
        "compose_profiles": compose_profiles(profile),
        "target_service_count": len(target),
        "target_services": target,
        "running_services": running,
        "services_to_stop": sorted(set(running) - set(target)),
    }


def running_services() -> list[str]:
    return sorted(
        row.get("Service")
        for row in compose_status()
        if row.get("Service") and row.get("State") == "running"
    )


def compose_status() -> list[dict[str, Any]]:
    result = run(["docker", "compose", *ALL_PROFILE_ARGS, "ps", "--format", "json"], check=False)
    if result.returncode != 0 or not result.stdout.strip():
        return []

    text = result.stdout.strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError:
        rows = []
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return rows


def status_payload() -> dict[str, Any]:
    manifest = load_manifest()
    rows = compose_status()
    running = sorted(
        row.get("Service")
        for row in rows
        if row.get("Service") and row.get("State") == "running"
    )
    return {
        "manifest_service_count": len(manifest["services"]),
        "running_count": len(running),
        "running_services": running,
        "compose_status": rows,
    }


def probe_endpoint(url: str, timeout: float = 2.0) -> dict[str, Any]:
    context = ssl._create_unverified_context() if url.startswith("https://") else None
    handlers: list[urllib.request.BaseHandler] = [urllib.request.ProxyHandler({})]
    if context is not None:
        handlers.append(urllib.request.HTTPSHandler(context=context))
    opener = urllib.request.build_opener(*handlers)
    try:
        with opener.open(url, timeout=timeout) as response:
            return {"status": "healthy", "http_status": response.status}
    except urllib.error.HTTPError as exc:
        return {"status": "responding", "http_status": exc.code}
    except Exception as exc:  # noqa: BLE001 - CLI health boundary
        return {"status": "unavailable", "error": exc.__class__.__name__}


def health_payload(*, probe_endpoints: bool = False, endpoint_timeout: float = 2.0) -> dict[str, Any]:
    manifest = load_manifest()
    compose_rows = {row.get("Service"): row for row in compose_status() if row.get("Service")}
    services: dict[str, dict[str, Any]] = {}

    for service_name, service in manifest["services"].items():
        compose_row = compose_rows.get(service_name, {})
        state = compose_row.get("State") or "missing"
        compose_health = compose_row.get("Health") or ""
        running = state == "running"
        if compose_health:
            ready = running and compose_health == "healthy"
            status = compose_health
        else:
            ready = False
            status = "readiness_signal_missing" if running else state
        endpoint = None

        health_endpoint = service.get("health_endpoint")
        if probe_endpoints and health_endpoint and running:
            endpoint = probe_endpoint(health_endpoint, timeout=endpoint_timeout)
            if endpoint["status"] == "unavailable":
                ready = False
                status = "endpoint_unavailable"
            elif not compose_health:
                ready = True
                status = endpoint["status"]

        services[service_name] = {
            "label": service["label"],
            "kind": service["kind"],
            "running": running,
            "ready": ready,
            "status": status,
            "compose_state": state,
            "compose_health": compose_health,
            "health_endpoint": health_endpoint,
            "endpoint": endpoint,
        }

    ready_services = [name for name, service in services.items() if service["ready"]]
    not_ready_services = [
        name for name, service in services.items() if not service["ready"]
    ]
    return {
        "profile": LOCKED_RUNTIME_PROFILE,
        "locked_runtime": True,
        "manifest_service_count": len(manifest["services"]),
        "service_count": len(services),
        "running_count": sum(1 for service in services.values() if service["running"]),
        "ready_count": len(ready_services),
        "not_ready_count": len(not_ready_services),
        "ready": len(not_ready_services) == 0,
        "ready_services": sorted(ready_services),
        "not_ready_services": sorted(not_ready_services),
        "services": services,
    }


def wait_for_health(timeout_seconds: int, interval_seconds: float) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    payload = health_payload()
    while not payload["ready"] and time.monotonic() < deadline:
        time.sleep(interval_seconds)
        payload = health_payload()
    return payload


def workspace_payload() -> dict[str, Any]:
    manifest = load_workspace_manifest()
    roots = []
    for item in manifest["roots"]:
        roots.append({**item, **path_payload(item["path"])})

    generated_artifacts = []
    for item in manifest.get("generated_artifacts", []):
        generated_artifacts.append({**item, **path_payload(item["path"])})

    return {
        "project": manifest["project"],
        "control": manifest["control"],
        "project_root": PROJECT_ROOT.as_posix(),
        "core_root": ROOT.as_posix(),
        "source_root_count": len(roots),
        "generated_artifact_count": len(generated_artifacts),
        "roots": roots,
        "external_mirrors": manifest.get("external_mirrors", []),
        "generated_artifacts": generated_artifacts,
    }


def git_status_for_root(root: dict[str, Any]) -> dict[str, Any]:
    relative_path = root["path"]
    absolute_path = project_path(relative_path)
    payload = {
        "key": root["key"],
        "label": root.get("label"),
        "kind": root.get("kind"),
        "path": relative_path,
        "absolute_path": absolute_path.as_posix(),
        "exists": absolute_path.exists(),
        "git": False,
        "dirty": False,
        "change_count": 0,
        "status_counts": {},
        "sample": [],
    }
    if not absolute_path.exists():
        return payload

    git_check = run(
        ["git", "-C", absolute_path.as_posix(), "rev-parse", "--is-inside-work-tree"],
        check=False,
    )
    if git_check.returncode != 0:
        return payload

    status = run(["git", "-C", absolute_path.as_posix(), "status", "--short"], check=False)
    lines = [line for line in status.stdout.splitlines() if line.strip()]
    status_counts = Counter(line[:2] for line in lines)
    payload.update(
        {
            "git": True,
            "dirty": bool(lines),
            "change_count": len(lines),
            "status_counts": dict(sorted(status_counts.items())),
            "sample": lines[:25],
        }
    )
    return payload


def repo_status_payload() -> dict[str, Any]:
    workspace = load_workspace_manifest()
    roots = [git_status_for_root(root) for root in workspace["roots"]]
    git_roots = [root for root in roots if root["git"]]
    dirty_roots = [root for root in git_roots if root["dirty"]]
    return {
        "project_root": PROJECT_ROOT.as_posix(),
        "core_root": ROOT.as_posix(),
        "root_count": len(roots),
        "git_root_count": len(git_roots),
        "dirty_root_count": len(dirty_roots),
        "change_count": sum(root["change_count"] for root in git_roots),
        "roots": roots,
    }


def clean_plan_payload() -> dict[str, Any]:
    workspace = load_workspace_manifest()
    artifacts = []
    for artifact in workspace.get("generated_artifacts", []):
        payload = {**artifact, **path_payload(artifact["path"])}
        payload["delete"] = payload["exists"]
        artifacts.append(payload)

    return {
        "action": "clean",
        "project_root": PROJECT_ROOT.as_posix(),
        "delete_count": sum(1 for artifact in artifacts if artifact["delete"]),
        "artifacts": artifacts,
    }


def doctor_check(name: str, relative_path: str, *, required: bool = True) -> dict[str, Any]:
    payload = path_payload(relative_path)
    if payload["exists"]:
        status = "ok"
    elif required:
        status = "error"
    else:
        status = "warning"
    return {"name": name, "status": status, **payload}


def doctor_payload() -> dict[str, Any]:
    workspace = load_workspace_manifest()
    control = workspace["control"]
    managed_root_paths = {root["path"] for root in workspace["roots"]}
    top_level_directories = {
        item.name
        for item in PROJECT_ROOT.iterdir()
        if item.is_dir() and not item.name.startswith(".")
    }
    unmanaged_top_level_directories = sorted(top_level_directories - managed_root_paths)
    checks = [
        doctor_check("compose_file", control["compose_file"]),
        doctor_check("services_manifest", control["services_manifest"]),
        doctor_check("workspace_manifest", control["workspace_manifest"]),
        doctor_check("primary_cli", control["primary_cli"]),
        doctor_check("top_level_windows_wrapper", control["wrappers"]["windows"]),
        doctor_check("top_level_powershell_wrapper", control["wrappers"]["powershell"]),
        doctor_check("top_level_shell_wrapper", control["wrappers"]["shell"]),
        doctor_check("ui_dockerfile", "askcos-vue-nginx/Dockerfile"),
        doctor_check("ui_dockerignore", "askcos-vue-nginx/.dockerignore"),
    ]

    root_checks = [
        {
            "name": f"root:{root['key']}",
            "status": "ok" if project_path(root["path"]).exists() else "error",
            **path_payload(root["path"]),
        }
        for root in workspace["roots"]
    ]
    checks.extend(root_checks)

    if unmanaged_top_level_directories:
        checks.append(
            {
                "name": "unmanaged_top_level_directories",
                "status": "error",
                "paths": unmanaged_top_level_directories,
            }
        )
    else:
        checks.append(
            {
                "name": "unmanaged_top_level_directories",
                "status": "ok",
                "paths": [],
            }
        )

    for artifact in workspace.get("generated_artifacts", []):
        payload = path_payload(artifact["path"])
        checks.append(
            {
                "name": f"generated:{artifact['path']}",
                "status": "warning" if payload["exists"] else "ok",
                "owner": artifact.get("owner"),
                "reason": artifact.get("reason"),
                **payload,
            }
        )

    summary = {
        "ok": sum(1 for check in checks if check["status"] == "ok"),
        "warnings": sum(1 for check in checks if check["status"] == "warning"),
        "errors": sum(1 for check in checks if check["status"] == "error"),
        "unmanaged_top_level_directories": len(unmanaged_top_level_directories),
    }
    return {
        "project_root": PROJECT_ROOT.as_posix(),
        "core_root": ROOT.as_posix(),
        "summary": summary,
        "checks": checks,
    }


def print_output(payload: Any, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
        return

    if isinstance(payload, dict):
        for key, value in payload.items():
            print(f"{key}: {value}")
    else:
        for item in payload:
            print(item)


def stop_services(services: list[str]) -> None:
    if not services:
        return
    result = run(["docker", "compose", *ALL_PROFILE_ARGS, "stop", *services], check=False)
    if result.returncode != 0:
        raise SystemExit(result.stderr.strip() or result.stdout.strip())


def start_profile(
    profile: str | None = None,
    *,
    wait: bool = True,
    timeout_seconds: int = 300,
    interval_seconds: float = 5.0,
) -> None:
    profile = normalize_locked_runtime_profile(profile)
    plan = start_plan(profile)
    stop_services(plan["services_to_stop"])
    command = ["docker", "compose", *compose_profiles(profile), "up", "-d", "--remove-orphans"]
    result = run(command, check=False)
    if result.returncode != 0:
        raise SystemExit(result.stderr.strip() or result.stdout.strip())
    print(result.stdout.strip())
    if wait:
        health = wait_for_health(timeout_seconds, interval_seconds)
        if not health["ready"]:
            print_output(health, as_json=True)
            raise SystemExit(
                f"ASKCOS full stack not ready: {health['not_ready_services']}"
            )
        print(
            f"ASKCOS full stack ready: "
            f"{health['ready_count']}/{health['service_count']} services"
        )


def stop_all() -> None:
    result = run(["docker", "compose", *ALL_PROFILE_ARGS, "stop"], check=False)
    if result.returncode != 0:
        raise SystemExit(result.stderr.strip() or result.stdout.strip())
    print(result.stdout.strip())


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage ASKCOS runtime profiles.")
    subcommands = parser.add_subparsers(dest="command", required=True)

    profiles_cmd = subcommands.add_parser("profiles", help="List runtime profiles.")
    profiles_cmd.add_argument("--json", action="store_true")

    workspace_cmd = subcommands.add_parser("workspace", help="Show ASKCOS workspace layout.")
    workspace_cmd.add_argument("--json", action="store_true")

    doctor_cmd = subcommands.add_parser("doctor", help="Check runtime control files.")
    doctor_cmd.add_argument("--json", action="store_true")

    status_cmd = subcommands.add_parser("status", help="Show runtime status.")
    status_cmd.add_argument("--json", action="store_true")

    health_cmd = subcommands.add_parser("health", help="Check full-stack runtime health.")
    health_cmd.add_argument("--json", action="store_true")
    health_cmd.add_argument("--probe-endpoints", action="store_true")
    health_cmd.add_argument("--timeout", type=float, default=2.0)

    repo_status_cmd = subcommands.add_parser(
        "repo-status", help="Summarize managed repository status."
    )
    repo_status_cmd.add_argument("--json", action="store_true")

    start_cmd = subcommands.add_parser(
        "start", help="Start the locked full ASKCOS backend stack."
    )
    start_cmd.add_argument("profile", nargs="?", default="full", choices=LOCKED_RUNTIME_CHOICES)
    start_cmd.add_argument("--wait", dest="wait", action="store_true", default=True)
    start_cmd.add_argument("--no-wait", dest="wait", action="store_false")
    start_cmd.add_argument("--timeout", type=int, default=300)
    start_cmd.add_argument("--interval", type=float, default=5.0)

    stop_cmd = subcommands.add_parser("stop", help="Stop all ASKCOS compose services.")
    stop_cmd.set_defaults(stop=True)

    plan_cmd = subcommands.add_parser("plan", help="Show what an action would do.")
    plan_subcommands = plan_cmd.add_subparsers(dest="plan_command", required=True)
    plan_start = plan_subcommands.add_parser("start", help="Plan the locked full stack start.")
    plan_start.add_argument("profile", nargs="?", default="full", choices=LOCKED_RUNTIME_CHOICES)
    plan_start.add_argument("--json", action="store_true")
    plan_clean = plan_subcommands.add_parser("clean", help="Plan generated artifact cleanup.")
    plan_clean.add_argument("--json", action="store_true")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.command == "profiles":
        print_output(load_manifest()["profiles"], args.json)
        return 0
    if args.command == "workspace":
        print_output(workspace_payload(), args.json)
        return 0
    if args.command == "doctor":
        payload = doctor_payload()
        print_output(payload, args.json)
        return 1 if payload["summary"]["errors"] else 0
    if args.command == "status":
        print_output(status_payload(), args.json)
        return 0
    if args.command == "health":
        payload = health_payload(
            probe_endpoints=args.probe_endpoints,
            endpoint_timeout=args.timeout,
        )
        print_output(payload, args.json)
        return 0 if payload["ready"] else 1
    if args.command == "repo-status":
        print_output(repo_status_payload(), args.json)
        return 0
    if args.command == "start":
        start_profile(
            args.profile,
            wait=args.wait,
            timeout_seconds=args.timeout,
            interval_seconds=args.interval,
        )
        return 0
    if args.command == "stop":
        stop_all()
        return 0
    if args.command == "plan" and args.plan_command == "start":
        print_output(start_plan(args.profile), args.json)
        return 0
    if args.command == "plan" and args.plan_command == "clean":
        print_output(clean_plan_payload(), args.json)
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
