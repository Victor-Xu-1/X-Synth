#!/usr/bin/env bash
set -euo pipefail

ROOT="${SYNON_REPO_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)}"
COMPOSE_DIR="$ROOT/apps/askcos-v2/askcos2_core"
LOG_DIR="${SYNON_ORCHESTRATOR_LOG_DIR:-/tmp/synon-orchestrator}"
PID_FILE="$LOG_DIR/uvicorn.pid"
SUPERVISOR_PID_FILE="$LOG_DIR/supervisor.pid"
HEALTH_URL="http://127.0.0.1:8790/synon-api/health"
ASKCOS_CONFIG_URL="${SYNON_ASKCOS_CONFIG_URL:-http://127.0.0.1:9100/api/frontend-config/get-all-config}"
COMPOSE_START_TIMEOUT_SECONDS="${SYNON_COMPOSE_START_TIMEOUT_SECONDS:-180}"
LOCAL_IMAGE_BUILD_TIMEOUT_SECONDS="${SYNON_LOCAL_IMAGE_BUILD_TIMEOUT_SECONDS:-900}"
ORCHESTRATOR_START_TIMEOUT_SECONDS="${SYNON_ORCHESTRATOR_START_TIMEOUT_SECONDS:-300}"
ASKCOS_MIN_BUYABLES_COUNT="${SYNON_ASKCOS_MIN_BUYABLES_COUNT:-800000}"
ASKCOS_REQUIRED_BUYABLES_SOURCES="${SYNON_ASKCOS_REQUIRED_BUYABLES_SOURCES:-CB,CS,MC,aladdin,ambeed,chemscene,combi_blocks,sigma_aldrich,targetmol}"
DOCKER_CONFIG_DIR="${SYNON_DOCKER_CONFIG_DIR:-$LOG_DIR/docker-config}"
DOCKER_CONTEXT_NAME="${SYNON_DOCKER_CONTEXT_NAME:-synon-local}"
DOCKER_ENDPOINT="${SYNON_DOCKER_ENDPOINT:-unix:///var/run/docker.sock}"

mkdir -p "$LOG_DIR"

prepare_project_docker_context() {
  mkdir -p "$DOCKER_CONFIG_DIR"
  export DOCKER_CONFIG="$DOCKER_CONFIG_DIR"

  if ! docker context inspect "$DOCKER_CONTEXT_NAME" >/dev/null 2>&1; then
    docker context create "$DOCKER_CONTEXT_NAME" \
      --docker "host=$DOCKER_ENDPOINT" >/dev/null
  fi
  docker context use "$DOCKER_CONTEXT_NAME" >/dev/null

  if ! docker info >/dev/null 2>&1; then
    echo "Error: Docker daemon is unavailable through $DOCKER_ENDPOINT." >&2
    return 1
  fi
}

prepare_project_docker_context

cd "$COMPOSE_DIR"
if [[ "${SYNON_SKIP_COMPOSE_START:-0}" != "1" ]]; then
  if [[ "${SYNON_BUILD_LOCAL_IMAGES:-1}" == "1" ]]; then
    timeout "$LOCAL_IMAGE_BUILD_TIMEOUT_SECONDS" \
      env COMPOSE_PROJECT_NAME=synonrt \
      docker compose -p synonrt build app celery_workers web
  fi
  if ! timeout "$COMPOSE_START_TIMEOUT_SECONDS" env COMPOSE_PROJECT_NAME=synonrt \
    docker compose -p synonrt --profile route-tree up -d; then
    if curl --noproxy "*" -fsS --max-time 5 "$ASKCOS_CONFIG_URL" >/dev/null 2>&1; then
      echo "Warning: ASKCOS is reachable but docker compose start timed out; continuing to start Synon orchestrator." >&2
    else
      echo "Error: docker compose start timed out and ASKCOS is not reachable at $ASKCOS_CONFIG_URL." >&2
      exit 1
    fi
  fi
fi

verify_askcos_buyables() {
  local mongo_container="${SYNON_ASKCOS_MONGO_CONTAINER:-synonrt-mongo-1}"
  local source_file="$ROOT/data/compiled/domestic_stock/askcos_buyables.json"
  local count sources missing=""

  count="$(docker exec "$mongo_container" mongosh askcos --quiet \
    -u askcos -p askcos --authenticationDatabase admin \
    --eval "print(db.buyables.countDocuments())" | tail -n 1 | tr -d '[:space:]')"
  sources="$(docker exec "$mongo_container" mongosh askcos --quiet \
    -u askcos -p askcos --authenticationDatabase admin \
    --eval "print(db.buyables.distinct('source').sort().join(','))" | tail -n 1)"

  IFS=',' read -r -a required_sources <<< "$ASKCOS_REQUIRED_BUYABLES_SOURCES"
  for source in "${required_sources[@]}"; do
    if [[ ",$sources," != *",$source,"* ]]; then
      missing="${missing:+$missing,}$source"
    fi
  done

  if [[ "$count" =~ ^[0-9]+$ ]] \
    && (( count >= ASKCOS_MIN_BUYABLES_COUNT )) \
    && [[ -z "$missing" ]]; then
    echo "ASKCOS commercial stock ready: $count records; sources=$sources"
    return 0
  fi

  if [[ "${SYNON_AUTO_IMPORT_ASKCOS_STOCK:-1}" != "1" || ! -f "$source_file" ]]; then
    echo "Error: ASKCOS commercial stock is incomplete: count=$count missing_sources=$missing" >&2
    return 1
  fi

  echo "ASKCOS commercial stock incomplete; importing compiled domestic stock." >&2
  "$ROOT/scripts/data_import/import_askcos_buyables_mongo.sh" --file "$source_file"

  count="$(docker exec "$mongo_container" mongosh askcos --quiet \
    -u askcos -p askcos --authenticationDatabase admin \
    --eval "print(db.buyables.countDocuments())" | tail -n 1 | tr -d '[:space:]')"
  if [[ ! "$count" =~ ^[0-9]+$ ]] || (( count < ASKCOS_MIN_BUYABLES_COUNT )); then
    echo "Error: ASKCOS commercial stock import did not reach the required count: $count" >&2
    return 1
  fi
}

if [[ "${SYNON_VERIFY_ASKCOS_STOCK:-1}" == "1" ]]; then
  verify_askcos_buyables
fi

stop_existing_orchestrator() {
  if [[ -f "$SUPERVISOR_PID_FILE" ]]; then
    old_supervisor_pid="$(cat "$SUPERVISOR_PID_FILE" || true)"
    if [[ -n "$old_supervisor_pid" ]] && kill -0 "$old_supervisor_pid" >/dev/null 2>&1; then
      kill "$old_supervisor_pid" >/dev/null 2>&1 || true
    fi
  fi

  while IFS= read -r pid; do
    if [[ -n "$pid" && "$pid" != "$$" ]]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done < <(pgrep -f "run_synon_orchestrator_supervisor[.]sh" || true)

  if [[ -f "$PID_FILE" ]]; then
    old_pid="$(cat "$PID_FILE" || true)"
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" >/dev/null 2>&1; then
      kill "$old_pid" >/dev/null 2>&1 || true
    fi
  fi

  while IFS= read -r pid; do
    if [[ -n "$pid" && "$pid" != "$$" ]]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done < <(pgrep -f "uvicorn apps[.]synon_orchestrator[.]app:app .*--port 8790" || true)
  sleep 1
}

if [[ "${SYNON_ORCHESTRATOR_FORCE_RESTART:-0}" != "1" ]] \
  && curl --noproxy "*" -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
  echo "Synon orchestrator already ready at $HEALTH_URL"
  exit 0
fi

stop_existing_orchestrator

template_db="${SYNON_TEMPLATE_LIBRARY_DB:-$ROOT/data/compiled/template_library/template_library.sqlite}"
if [[ ! -f "$template_db" ]]; then
  template_db="$ROOT/tests/real-cases/data-compiler-smoke/template_library_runtime/template_library.sqlite"
fi

stock_paths="${SYNON_EXTERNAL_STOCK_PATHS:-}"
if [[ -z "$stock_paths" && -f "$ROOT/data/compiled/domestic_stock/synon_stock.json" ]]; then
  stock_paths="$ROOT/data/compiled/domestic_stock/synon_stock.json"
fi

cd "$ROOT"
nohup env \
  SYNON_REPO_ROOT="$ROOT" \
  SYNON_ORCHESTRATOR_LOG_DIR="$LOG_DIR" \
  SYNON_TEMPLATE_LIBRARY_DB="$template_db" \
  SYNON_EXTERNAL_STOCK_PATHS="$stock_paths" \
  SYNON_ONLINE_SUPPLIERS="${SYNON_ONLINE_SUPPLIERS:-pubchem}" \
  SYNON_AUTO_RESUME_INTERRUPTED_JOBS="${SYNON_AUTO_RESUME_INTERRUPTED_JOBS:-1}" \
  bash "$ROOT/scripts/operations/run_synon_orchestrator_supervisor.sh" \
  > "$LOG_DIR/supervisor.out" 2> "$LOG_DIR/supervisor.err" &
echo "$!" > "$SUPERVISOR_PID_FILE"

orchestrator_deadline=$((SECONDS + ORCHESTRATOR_START_TIMEOUT_SECONDS))
while (( SECONDS < orchestrator_deadline )); do
  if curl --noproxy "*" -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Synon workbench ready: http://127.0.0.1:8769/"
    exit 0
  fi
  sleep 2
done

echo "Synon orchestrator did not become ready. See $LOG_DIR/out.log and $LOG_DIR/err.log" >&2
exit 1
