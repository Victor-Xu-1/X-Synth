#!/usr/bin/env bash
set -euo pipefail

ROOT="${SYNON_REPO_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)}"
PYTHON="${SYNON_PYTHON:-$ROOT/.venv/bin/python}"
LOG_DIR="${SYNON_ORCHESTRATOR_LOG_DIR:-/tmp/synon-orchestrator}"
PORT="${SYNON_ORCHESTRATOR_PORT:-8790}"
RESTART_DELAY_SEC="${SYNON_ORCHESTRATOR_RESTART_DELAY_SEC:-3}"

mkdir -p "$LOG_DIR"
cd "$ROOT"

while true; do
  printf '%s starting synon orchestrator on port %s\n' "$(date -Is)" "$PORT" >> "$LOG_DIR/supervisor.log"
  set +e
  PYTHONPATH="$ROOT" "$PYTHON" -m uvicorn apps.synon_orchestrator.app:app --host 127.0.0.1 --port "$PORT" \
    >> "$LOG_DIR/out.log" 2>> "$LOG_DIR/err.log"
  exit_code=$?
  set -e
  printf '%s synon orchestrator exited with code %s; restarting in %ss\n' \
    "$(date -Is)" "$exit_code" "$RESTART_DELAY_SEC" >> "$LOG_DIR/supervisor.log"
  sleep "$RESTART_DELAY_SEC"
done
