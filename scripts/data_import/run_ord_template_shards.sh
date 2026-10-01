#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/home/victor_1/synon-retrosynthesis-platform}"
PYTHON_BIN="${PYTHON_BIN:-${PROJECT_ROOT}/.venv_ord_template/bin/python}"
ORD_DATA_DIR="${ORD_DATA_DIR:-data/external/ord-data/data}"
OUTPUT_ROOT="${OUTPUT_ROOT:-data/compiled/ord_templates_full}"
MERGED_OUTPUT_DIR="${MERGED_OUTPUT_DIR:-${OUTPUT_ROOT}/merged}"
TEMPLATE_LIBRARY_OUTPUT_DIR="${TEMPLATE_LIBRARY_OUTPUT_DIR:-data/compiled/template_library}"
SHARD_COUNT="${SHARD_COUNT:-2}"
MAPPER_PORTS="${MAPPER_PORTS:-9671 9672}"
ATOM_MAP_BATCH_SIZE="${ATOM_MAP_BATCH_SIZE:-64}"
CHECKPOINT_EVERY="${CHECKPOINT_EVERY:-500}"
VERSION="${VERSION:-unified-ord-full}"
LIMIT_REACTIONS_PER_SHARD="${LIMIT_REACTIONS_PER_SHARD:-}"
INSTALL_MERGED_ORD="${INSTALL_MERGED_ORD:-1}"

cd "$PROJECT_ROOT"

if [ ! -x "$PYTHON_BIN" ]; then
  echo "Python environment not found or not executable: $PYTHON_BIN" >&2
  exit 2
fi

read -r -a ports <<< "$MAPPER_PORTS"
if [ "${#ports[@]}" -lt "$SHARD_COUNT" ]; then
  echo "MAPPER_PORTS must contain at least SHARD_COUNT ports." >&2
  exit 2
fi

mkdir -p "$OUTPUT_ROOT"

for shard in $(seq 0 $((SHARD_COUNT - 1))); do
  port="${ports[$shard]}"
  if ! curl -fsS --noproxy '*' "http://127.0.0.1:${port}/docs" >/dev/null; then
    echo "Atom-map endpoint is not ready: http://127.0.0.1:${port}" >&2
    exit 3
  fi
done

pids=()
for shard in $(seq 0 $((SHARD_COUNT - 1))); do
  shard_label="$(printf 'shard_%02d' "$shard")"
  shard_dir="${OUTPUT_ROOT}/${shard_label}"
  shard_log="${OUTPUT_ROOT}/${shard_label}.log"
  port="${ports[$shard]}"
  mkdir -p "$shard_dir"
  resume_args=()
  if [ -f "${shard_dir}/checkpoint.json" ]; then
    resume_args=(--resume)
  fi
  limit_args=()
  if [ -n "$LIMIT_REACTIONS_PER_SHARD" ]; then
    limit_args=(--limit-reactions "$LIMIT_REACTIONS_PER_SHARD")
  fi
  "$PYTHON_BIN" scripts/data_import/extract_ord_templates.py \
    --ord-data-dir "$ORD_DATA_DIR" \
    --output-dir "$shard_dir" \
    --file-shard-count "$SHARD_COUNT" \
    --file-shard-index "$shard" \
    --atom-map-url "http://127.0.0.1:${port}/ibm_rxnmapper" \
    --atom-map-batch-size "$ATOM_MAP_BATCH_SIZE" \
    --checkpoint-every "$CHECKPOINT_EVERY" \
    "${limit_args[@]}" \
    "${resume_args[@]}" \
    > "$shard_log" 2>&1 &
  pids+=("$!")
  echo "$!" > "${OUTPUT_ROOT}/${shard_label}.pid"
done

status=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo "At least one ORD shard extraction failed. Inspect ${OUTPUT_ROOT}/shard_*.log." >&2
  exit "$status"
fi

"$PYTHON_BIN" scripts/data_import/merge_ord_template_shards.py \
  --shards-dir "$OUTPUT_ROOT" \
  --output-dir "$MERGED_OUTPUT_DIR"

if [ "$INSTALL_MERGED_ORD" != "1" ]; then
  exit 0
fi

mkdir -p data/compiled/ord_templates
cp "${MERGED_OUTPUT_DIR}/retro.templates.ord_extracted.json.gz" \
  data/compiled/ord_templates/retro.templates.ord_extracted.json.gz
cp "${MERGED_OUTPUT_DIR}/summary.json" \
  data/compiled/ord_templates/summary.json

PYTHONPATH=. "$PYTHON_BIN" scripts/data_import/compile_template_library.py \
  --include-standard-local-sources \
  --project-root . \
  --output-dir "$TEMPLATE_LIBRARY_OUTPUT_DIR" \
  --version "$VERSION" \
  --export-runtime-assets
