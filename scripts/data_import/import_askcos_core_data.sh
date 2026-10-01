#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/victor_1/synon-retrosynthesis-platform/apps/askcos-v2/askcos2_core"
TEMPLATE_ROOT="${SYNON_TEMPLATE_RUNTIME_ASSETS_DIR:-${ROOT}/data/db/templates}"
TEMPLATE_RUNTIME_OVERLAY="${SYNON_TEMPLATE_RUNTIME_ASSETS_DIR:-}"
PROJECT="${COMPOSE_PROJECT_NAME:-synonrt}"
PROFILE="${ASKCOS_PROFILE:-route-tree}"
RETRO_TEMPLATE_SEED="default"
FORWARD_TEMPLATE_SEED="default"
if [[ -n "$TEMPLATE_RUNTIME_OVERLAY" ]]; then
  RETRO_TEMPLATE_SEED="${TEMPLATE_ROOT}/retro.templates.synon_unified.json.gz"
  FORWARD_TEMPLATE_SEED="${TEMPLATE_ROOT}/forward.templates.json.gz"
fi

required_files=(
  "data/db/buyables/mcule_buyables_fd2.json.gz"
  "data/db/buyables/chembridge_buyables.json.gz"
  "data/db/buyables/chemspace_buyables_2026Apr.json.gz"
  "data/db/buyables/buyables.json.gz"
  "data/db/historian/chemicals.json.gz"
  "data/db/historian/historian.pistachio.json.gz"
  "data/db/historian/historian.bkms_metabolic.json.gz"
  "data/db/historian/reactions.pistachio.json.gz"
  "data/db/historian/reactions.bkms_metabolic.json.gz"
  "data/db/historian/reactions.USPTO_FULL.json.gz"
  "data/db/historian/historian.uspto_higher_level.json.gz"
  "data/db/historian/reactions.uspto_higher_level.json.gz"
  "data/db/references/site_selectivity.refs.json.gz"
)

required_template_files=(
  "${TEMPLATE_ROOT}/retro.templates.reaxys.json.gz"
  "${TEMPLATE_ROOT}/retro.templates.pistachio.json.gz"
  "${TEMPLATE_ROOT}/retro.templates.bkms_metabolic.json.gz"
  "${TEMPLATE_ROOT}/retro.templates.pistachio_ringbreaker.json.gz"
  "${TEMPLATE_ROOT}/retro.templates.reaxys_biocatalysis.json.gz"
  "${TEMPLATE_ROOT}/retro.templates.uspto_higher_level.json.gz"
  "${TEMPLATE_ROOT}/forward.templates.json.gz"
)
if [[ -n "$TEMPLATE_RUNTIME_OVERLAY" ]]; then
  required_template_files=("${TEMPLATE_ROOT}/retro.templates.synon_unified.json.gz" "${required_template_files[@]}")
fi

log() {
  printf '[import-askcos-core-data] %s\n' "$*"
}

mongo_count() {
  local collection="$1"
  docker compose -p "$PROJECT" exec -T mongo \
    mongosh --quiet -u askcos -p askcos --authenticationDatabase admin \
    --eval "db.getSiblingDB('askcos').${collection}.estimatedDocumentCount({})" \
    | tr -d '\r'
}

mongo_template_set_count() {
  local collection="$1"
  local template_set="$2"
  docker compose -p "$PROJECT" exec -T mongo \
    mongosh --quiet -u askcos -p askcos --authenticationDatabase admin \
    --eval "db.getSiblingDB('askcos').${collection}.countDocuments({template_set: '${template_set}'})" \
    | tr -d '\r'
}

require_file() {
  local rel="$1"
  if [[ ! -f "${ROOT}/${rel}" ]]; then
    printf 'Missing required ASKCOS data file: %s\n' "${ROOT}/${rel}" >&2
    exit 2
  fi
}

cd "$ROOT"

for rel in "${required_files[@]}"; do
  require_file "$rel"
done
for path in "${required_template_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    printf 'Missing required ASKCOS template file: %s\n' "$path" >&2
    exit 2
  fi
done

if docker ps --format '{{.Names}}' | grep -Eq '^deploy-(app|mongo|rabbitmq|redis|mcts|retro_star|celery_workers)-'; then
  cat >&2 <<'EOF'
Refusing to import while old deploy-* ASKCOS containers are running.
Stop the old project without deleting volumes first:
  docker compose -p deploy --profile route-tree down
  docker compose -p deploy down
EOF
  exit 3
fi

log "Using project=${PROJECT}, profile=${PROFILE}, template_root=${TEMPLATE_ROOT}, retro_seed=${RETRO_TEMPLATE_SEED}, forward_seed=${FORWARD_TEMPLATE_SEED}"
log "Stopping API/search containers before database seeding."
COMPOSE_PROJECT_NAME="$PROJECT" docker compose -p "$PROJECT" --profile "$PROFILE" stop \
  app celery_workers mcts retro_star expand_one retro_exact_match retro_retrosim web 2>/dev/null || true

log "Checking existing Mongo collection counts."
COMPOSE_PROJECT_NAME="$PROJECT" docker compose -p "$PROJECT" up -d mongo >/dev/null

buyables_count="$(mongo_count buyables)"
chemicals_count="$(mongo_count chemicals)"
reactions_count="$(mongo_count reactions)"
retro_count="$(mongo_count retro_templates)"
forward_count="$(mongo_count forward_templates)"
refs_count="$(mongo_count sites_refs)"
uspto_chemicals_count="$(mongo_template_set_count chemicals uspto_higher_level)"
uspto_reactions_count="$(mongo_template_set_count reactions uspto_higher_level)"
uspto_templates_count="$(mongo_template_set_count retro_templates uspto_higher_level)"
pistachio_ringbreaker_templates_count="$(mongo_template_set_count retro_templates 'pistachio:ringbreaker')"

log "Existing counts: buyables=${buyables_count}, chemicals=${chemicals_count}, reactions=${reactions_count}, retro_templates=${retro_count}, forward_templates=${forward_count}, sites_refs=${refs_count}"
log "Existing uspto_higher_level counts: chemicals=${uspto_chemicals_count}, reactions=${uspto_reactions_count}, retro_templates=${uspto_templates_count}"
log "Existing pistachio_ringbreaker templates count: retro_templates=${pistachio_ringbreaker_templates_count}"

seed_args=()
seeded_unified_retro=false
if [[ "$buyables_count" == "0" ]]; then
  seed_args+=("-b" "default")
fi
if [[ "$chemicals_count" == "0" ]]; then
  seed_args+=("-c" "default")
fi
if [[ "$reactions_count" == "0" ]]; then
  seed_args+=("-x" "default")
fi
if [[ "$retro_count" == "0" ]]; then
  seed_args+=("-r" "$RETRO_TEMPLATE_SEED")
  if [[ -n "$TEMPLATE_RUNTIME_OVERLAY" ]]; then
    seeded_unified_retro=true
  fi
fi
if [[ "$forward_count" == "0" ]]; then
  seed_args+=("-t" "$FORWARD_TEMPLATE_SEED")
fi
if [[ "$refs_count" == "0" ]]; then
  seed_args+=("-e" "default")
  if [[ "$buyables_count" != "0" && "$retro_count" != "0" && "$forward_count" != "0" ]]; then
    # ASKCOS deploy.sh checks a legacy REFERENCES variable before seeding.
    # Including buyables is idempotent because deploy.sh imports it with upsert.
    seed_args+=("-b" "default")
  fi
fi
if [[ "$uspto_chemicals_count" == "0" ]]; then
  seed_args+=("-c" "${ROOT}/data/db/historian/historian.uspto_higher_level.json.gz")
fi
if [[ "$uspto_reactions_count" == "0" ]]; then
  seed_args+=("-x" "${ROOT}/data/db/historian/reactions.uspto_higher_level.json.gz")
fi
if [[ "$uspto_templates_count" == "0" && "$seeded_unified_retro" != "true" ]]; then
  seed_args+=("-r" "${TEMPLATE_ROOT}/retro.templates.uspto_higher_level.json.gz")
elif [[ "$retro_count" != "0" && "$pistachio_ringbreaker_templates_count" == "0" ]]; then
  seed_args+=("-r" "${TEMPLATE_ROOT}/retro.templates.pistachio_ringbreaker.json.gz")
fi

if [[ "${#seed_args[@]}" -eq 0 ]]; then
  log "All core collections already contain data; skipping seed-db."
else
  log "Running original ASKCOS seed-db for missing collections: ${seed_args[*]}"
  COMPOSE_PROJECT_NAME="$PROJECT" bash ./deploy.sh "${seed_args[@]}" seed-db
fi

log "Restarting ASKCOS stack after seeding."
COMPOSE_PROJECT_NAME="$PROJECT" docker compose -p "$PROJECT" --profile "$PROFILE" up -d --no-build

log "Import finished. Run scripts/diagnostics/check_askcos_stack.sh and count Mongo collections next."
