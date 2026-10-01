#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/data_import/import_askcos_buyables_mongo.sh --file <askcos_buyables.json> [options]

Imports compiled ASKCOS-compatible buyables into the ASKCOS MongoDB buyables
collection. The import is idempotent for the same (smiles, source) pair.

Options:
  --file PATH                 JSON array file produced by compile_domestic_stock.py
  --container NAME            Mongo container name (default: synonrt-mongo-1)
  --database NAME             Mongo database (default: askcos)
  --collection NAME           Mongo collection (default: buyables)
  --username USER             Mongo username (default: askcos)
  --password PASS             Mongo password (default: askcos)
  --auth-db NAME              Mongo auth database (default: admin)
  --mode MODE                 mongoimport mode (default: upsert)
  --upsert-fields FIELDS      upsert key (default: smiles,source)
EOF
}

input_file=""
container="synonrt-mongo-1"
database="askcos"
collection="buyables"
username="askcos"
password="askcos"
auth_db="admin"
mode="upsert"
upsert_fields="smiles,source"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)
      input_file="${2:-}"
      shift 2
      ;;
    --container)
      container="${2:-}"
      shift 2
      ;;
    --database)
      database="${2:-}"
      shift 2
      ;;
    --collection)
      collection="${2:-}"
      shift 2
      ;;
    --username)
      username="${2:-}"
      shift 2
      ;;
    --password)
      password="${2:-}"
      shift 2
      ;;
    --auth-db)
      auth_db="${2:-}"
      shift 2
      ;;
    --mode)
      mode="${2:-}"
      shift 2
      ;;
    --upsert-fields)
      upsert_fields="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$input_file" ]]; then
  echo "--file is required" >&2
  usage >&2
  exit 2
fi
if [[ ! -f "$input_file" ]]; then
  echo "Input file does not exist: $input_file" >&2
  exit 1
fi
if ! docker inspect "$container" >/dev/null 2>&1; then
  echo "Mongo container is not running or not found: $container" >&2
  exit 1
fi
if ! docker exec "$container" sh -lc "command -v mongoimport >/dev/null"; then
  echo "mongoimport is not available in container: $container" >&2
  exit 1
fi

remote_file="/tmp/synon_askcos_buyables_$(date +%Y%m%d_%H%M%S).json"
before_count="$(
  docker exec "$container" mongosh "$database" --quiet \
    -u "$username" -p "$password" --authenticationDatabase "$auth_db" \
    --eval "db.getCollection('$collection').countDocuments()"
)"

docker cp "$input_file" "$container:$remote_file"
docker exec "$container" mongoimport \
  --db "$database" \
  --collection "$collection" \
  --file "$remote_file" \
  --jsonArray \
  --mode "$mode" \
  --upsertFields "$upsert_fields" \
  -u "$username" \
  -p "$password" \
  --authenticationDatabase "$auth_db"

docker exec "$container" mongosh "$database" --quiet \
  -u "$username" -p "$password" --authenticationDatabase "$auth_db" \
  --eval "db.getCollection('$collection').createIndex({smiles: 1, source: 1}); db.getCollection('$collection').createIndex({source: 1}); printjson({before: Number('$before_count'), after: db.getCollection('$collection').countDocuments(), sources: db.getCollection('$collection').distinct('source').sort()})"

docker exec "$container" rm -f "$remote_file" >/dev/null
