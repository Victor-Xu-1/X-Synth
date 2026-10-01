#!/usr/bin/env bash
set -uo pipefail

ROOT="/home/victor_1/synon-retrosynthesis-platform/apps/askcos-v2/askcos2_core"
cd "$ROOT" || exit 2
PROJECT="${COMPOSE_PROJECT_NAME:-synonrt}"

echo "== Docker services =="
if command -v docker >/dev/null 2>&1; then
  docker compose -p "$PROJECT" ps || echo "docker compose ps: unavailable or stack is not running"
else
  echo "docker: command not found"
fi

echo "== HTTP checks =="
python3 - <<'PY'
import urllib.request

checks = {
    "ui": "http://127.0.0.1:8769",
    "api": "http://127.0.0.1:9100/api/runtime/services",
    "mcts": "http://127.0.0.1:9311/docs",
    "retro_star": "http://127.0.0.1:9321/docs",
    "expand_one": "http://127.0.0.1:9301/docs",
    "retro_exact_match": "http://127.0.0.1:9451/docs",
    "retro_retrosim": "http://127.0.0.1:9441/docs",
}

for name, url in checks.items():
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            print(f"{name}: {response.status} {url}")
    except Exception as exc:
        print(f"{name}: FAIL {type(exc).__name__}: {exc} ({url})")
PY
