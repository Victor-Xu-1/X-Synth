# Operations

## Start ASKCOS stack

Run from WSL:

    cd /home/victor_1/synon-retrosynthesis-platform/apps/askcos-v2/askcos2_core
    COMPOSE_PROJECT_NAME=synonrt docker compose -p synonrt --profile route-tree up -d

When ASKCOS is launched from Windows automation, keep a persistent WSL session
alive while long route-search jobs are running. Otherwise WSL can stop the
Ubuntu VM after the command exits and interrupt MongoDB, RabbitMQ, Redis, and
Celery tasks.

## Check health

Run from WSL:

    /home/victor_1/synon-retrosynthesis-platform/scripts/diagnostics/check_askcos_stack.sh

## Start Synon unified route orchestrator

The Synon UI submits route-tree jobs to `/synon-api/unified-route/call-async`.
Nginx proxies that path to the WSL host orchestrator on port `8790`.

For the complete local workbench, use the managed startup command. It starts
the existing ASKCOS compose project, waits for cold model loading, then starts
the supervised orchestrator:

    cd /home/victor_1/synon-retrosynthesis-platform
    bash scripts/operations/start_synon_workbench.sh

`SYNON_ORCHESTRATOR_START_TIMEOUT_SECONDS` controls only the startup health
wait and defaults to 180 seconds. `SYNON_AUTO_RESUME_INTERRUPTED_JOBS=1` is
enabled by the managed command. A job interrupted by a WSL or orchestrator
restart resumes from its persisted checkpoint and receives only the unused
portion of its original `total_timeout_sec`; the restart cannot extend the
one-hour job budget.

Run from WSL:

    cd /home/victor_1/synon-retrosynthesis-platform
    PYTHONPATH=. \
    SYNON_TEMPLATE_LIBRARY_DB=data/compiled/template_library/template_library.sqlite \
    SYNON_EXTERNAL_STOCK_PATHS=data/compiled/domestic_stock/synon_stock.json \
    python3 -m uvicorn apps.synon_orchestrator.app:app --host 0.0.0.0 --port 8790

For a detached local session:

    cd /home/victor_1/synon-retrosynthesis-platform
    mkdir -p /tmp/synon-orchestrator
    nohup env PYTHONPATH=. \
      SYNON_TEMPLATE_LIBRARY_DB=data/compiled/template_library/template_library.sqlite \
      SYNON_EXTERNAL_STOCK_PATHS=data/compiled/domestic_stock/synon_stock.json \
      python3 -m uvicorn apps.synon_orchestrator.app:app --host 0.0.0.0 --port 8790 \
      > /tmp/synon-orchestrator/out.log 2> /tmp/synon-orchestrator/err.log &

Check direct and nginx-proxied health:

    curl http://127.0.0.1:8790/synon-api/health
    curl http://127.0.0.1:8769/synon-api/health

## Check AiZynthFinder

AiZynthFinder is a secondary route generator. It runs through the local
`deepretro` conda environment and the model files under
`/home/victor_1/synon-retrosynthesis-platform/engines/aizynthfinder/models`.

Run from WSL:

    cd /home/victor_1/synon-retrosynthesis-platform
    PYTHONPATH=. python3 scripts/diagnostics/run_aizynthfinder_case.py --smiles 'CCOC(=O)c1ccccc1' --id ethyl_benzoate --model USPTO --timeout-sec 1800

Successful runs write `result.json`, `unified_routes.json`, and
`selected_routes.json` under `tests/real-cases/runs/<timestamp>_aizynthfinder_<id>/`.
`selected_routes.json` is the normalized 3-10 route contract that should be
merged into the ASKCOS final selector in the next integration slice.

`Pistachio_100+` is not enabled unless the licensed ONNX/template assets exist
under `engines/aizynthfinder/models/Pistachio_100+/`. The adapter must fail
when these files are missing; it must not silently fall back to USPTO.

## Build unified route pool

Use this when ASKCOS and AiZynthFinder have both produced route results for the
same target:

    cd /home/victor_1/synon-retrosynthesis-platform
    PYTHONPATH=. python3 scripts/diagnostics/build_unified_route_pool.py \
      --id askcos_aizynth_case \
      --askcos-task-id <completed-askcos-task-id> \
      --aizynth-result tests/real-cases/runs/<aizynth-run>/result.json \
      --min-routes 3 \
      --max-routes 10

The script validates that all route sources describe the same target after RDKit
canonicalization, ranks routes, preserves at least one closed route from each
engine when possible, and writes `unified_routes.json`, `selected_routes.json`,
and `summary.json`.

To make the selected unified pool visible in ASKCOS/Synon history, write it
back to an existing completed ASKCOS task:

    cd /home/victor_1/synon-retrosynthesis-platform
    PYTHONPATH=. python3 scripts/diagnostics/build_unified_route_pool.py \
      --id askcos_aizynth_case_writeback \
      --askcos-task-id <completed-askcos-task-id> \
      --aizynth-result tests/real-cases/runs/<aizynth-run>/result.json \
      --write-back-task-id <completed-askcos-task-id> \
      --public \
      --min-routes 3 \
      --max-routes 10

Use `--public` for local smoke results that should be visible to the current
workbench user. Use `--share-with <username>` when a result should remain
private but visible to a specific ASKCOS user. Do not bypass `/api/results/list`
user filtering in the UI; visibility should be handled by `public` or
`shared_with` in Mongo.

If the browser shows an empty results page immediately after a container restart,
the local JWT may be stale. The frontend now retries guest login once when it
receives `401` and stored guest credentials are available; otherwise it clears
the stale token and returns to the login page.

## Run unified ASKCOS + AiZynthFinder task

The normal UI route-tree submission path now uses this orchestration through
`/synon-api/unified-route/call-async`. Use the command below for operator-level
diagnostics or reruns without the browser:

    cd /home/victor_1/synon-retrosynthesis-platform
    printf '%s\n' 'OC(C(F)=CC=C1)=C1C2=CC3=C(NCC34CCNCC4)N=N2' > /tmp/target.smi
    PYTHONPATH=. python3 scripts/diagnostics/run_unified_route_case.py \
      --smiles-file /tmp/target.smi \
      --id fused_pyridazine_case \
      --backend retro_star \
      --expansion-time 1800 \
      --max-paths 200 \
      --askcos-timeout-sec 7200 \
      --poll-sec 60 \
      --aizynth-model USPTO \
      --aizynth-timeout-sec 3600 \
      --min-routes 3 \
      --max-routes 10 \
      --public

The runner starts ASKCOS and AiZynthFinder in parallel, normalizes both outputs
into `RouteCandidate`, applies the unified route-pool selector, and writes the
selected pool into the ASKCOS task history. Use `--smiles-file` for complex
SMILES to avoid Windows/WSL shell quoting issues; the runner reads UTF-8 files
with BOM-safe handling.

If rebuilding a unified pool from an existing ASKCOS Mongo task, pass
`--askcos-engine askcos_retro_star` when the persisted ASKCOS settings do not
include the original tree-search backend:

    PYTHONPATH=. python3 scripts/diagnostics/build_unified_route_pool.py \
      --id fused_pyridazine_rebuild \
      --askcos-task-id <completed-askcos-task-id> \
      --askcos-engine askcos_retro_star \
      --aizynth-result tests/real-cases/runs/<run>/aizynthfinder_result.json \
      --write-back-task-id <completed-askcos-task-id> \
      --public \
      --min-routes 3 \
      --max-routes 10

The selector does not force exactly 10 routes. It returns 3-10 closed routes and
removes redundant ASKCOS routes from the same first-step reaction cluster when
other real route families are available.

To submit through the same nginx path used by the UI:

    curl -H "Content-Type: application/json" \
      -X POST http://127.0.0.1:8769/synon-api/unified-route/call-async \
      --data '{"smiles":"OC(C(F)=CC=C1)=C1C2=CC3=C(NCC34CCNCC4)N=N2","description":"ui_proxy_unified_route_real_target","backend":"all","expansion_time":1200,"max_paths":200,"askcos_timeout_sec":1500,"poll_sec":30,"aizynth_model":"USPTO","aizynth_timeout_sec":1080,"total_timeout_sec":3600,"min_routes":3,"max_routes":10,"public":true}'

Poll the job:

    curl http://127.0.0.1:8769/synon-api/unified-route/jobs/<job_id>

## Build unified template library

The canonical template database must include both the ASKCOS template directory
and the standard local USPTO/ORD locations. Do not rebuild from the ASKCOS
directory alone, because that excludes `USPTO_50k` and the AiZynthFinder USPTO
template CSV files.

Run from WSL:

    cd /home/victor_1/synon-retrosynthesis-platform
    PYTHONPATH=. python3 scripts/data_import/compile_template_library.py \
      --source-dir apps/askcos-v2/askcos2_core/data/db/templates \
      --include-standard-local-sources \
      --project-root . \
      --output-dir data/compiled/template_library \
      --version 2026.07 \
      --export-runtime-assets

Current standard local sources:

| Source | Status |
|---|---|
| `uspto_higher_level` | included from ASKCOS core templates |
| `uspto_50k` | included from ASKCOS template-enumeration data |
| `uspto_aizynthfinder` | included from `engines/aizynthfinder/models/uspto_templates.csv.gz` |
| `uspto_ringbreaker_aizynthfinder` | included from `engines/aizynthfinder/models/uspto_ringbreaker_templates.csv.gz` |
| `ord` / `ord_extracted` | discovered when real extracted ORD template files exist under `data/sources/ord`, `data/raw/ord`, `data/external/ord`, or `data/compiled/ord_templates` |

## Download and extract ORD templates

ORD is distributed as Protobuf `.pb.gz` records in the official
`open-reaction-database/ord-data` repository. A plain Git clone only gives Git
LFS pointer files unless `git-lfs` is installed, so the stable local path uses
the official Hugging Face dataset mirror.

Run from WSL:

    cd /home/victor_1/synon-retrosynthesis-platform
    GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 \
      https://github.com/open-reaction-database/ord-data.git \
      data/external/ord-data

Create a tool venv outside the project tree:

    python3 -m venv /tmp/synon-ord-venv
    /tmp/synon-ord-venv/bin/python -m pip install -U pip
    /tmp/synon-ord-venv/bin/python -m pip install ord-schema rdchiral pebble huggingface_hub

Download the real ORD LFS objects from the official mirror:

    /tmp/synon-ord-venv/bin/python - <<'PY'
    from huggingface_hub import snapshot_download
    snapshot_download(
        repo_id="open-reaction-database/ord-data",
        repo_type="dataset",
        local_dir="data/external/ord-data",
        allow_patterns=["data/**/*.pb.gz", "data/**/*.parquet", "README.md", "LICENSE", "CITATION.cff"],
        max_workers=8,
    )
    PY

Extract ORD templates. The atom-map URL should point directly at the local
ASKCOS `atom_map_rxnmapper` service. The extractor disables proxy use for
localhost URLs because WSL proxy variables can otherwise route local calls
through the HTTP proxy and produce 502s.

    /tmp/synon-ord-venv/bin/python scripts/data_import/extract_ord_templates.py \
      --ord-data-dir data/external/ord-data/data \
      --output-dir data/compiled/ord_templates \
      --limit-reactions 1000 \
      --atom-map-url http://127.0.0.1:9671/ibm_rxnmapper \
      --atom-map-batch-size 64

Remove `--limit-reactions` for a full ORD extraction run. Full extraction is a
long atom-mapping job; partial extractions are still real ORD-derived templates
and are audited through `data/compiled/ord_templates/ord_reactions.csv.gz`.

## Import ASKCOS core data

Route-tree search depends on ASKCOS Mongo collections. A fresh `synonrt`
volume starts with empty `buyables`, `chemicals`, `reactions`,
`retro_templates`, `forward_templates`, and `sites_refs` collections. If these
collections are empty, ASKCOS can finish a task while returning zero closed
routes because every precursor is treated as non-terminal.

Run from WSL:

    COMPOSE_PROJECT_NAME=synonrt /home/victor_1/synon-retrosynthesis-platform/scripts/data_import/import_askcos_core_data.sh

The script deliberately calls the original ASKCOS `deploy.sh set-db-defaults
seed-db` path instead of reimplementing ASKCOS import logic. It refuses to run
when old `deploy-*` ASKCOS containers are active, because mixed Compose project
names can attach the route-search services to the wrong Mongo/Rabbit/Redis
containers.

After import, verify the core collection counts:

    docker exec synonrt-mongo-1 mongosh --quiet -u askcos -p askcos --authenticationDatabase admin --eval "const dbx=db.getSiblingDB('askcos'); printjson({buyables:dbx.buyables.estimatedDocumentCount(), chemicals:dbx.chemicals.estimatedDocumentCount(), reactions:dbx.reactions.estimatedDocumentCount(), retro_templates:dbx.retro_templates.estimatedDocumentCount(), forward_templates:dbx.forward_templates.estimatedDocumentCount(), sites_refs:dbx.sites_refs.estimatedDocumentCount()})"

## Required stable services

| Service | Required |
|---|---|
| web | yes |
| app | yes |
| mongo | yes |
| rabbitmq | yes |
| redis | yes |
| celery_workers | yes |
| mcts | yes |
| retro_star | yes |
| expand_one | yes |
| retro_template_relevance | yes |
| retro_exact_match | yes |
| retro_retrosim | yes |
| fast_filter | yes |
| scscore | yes |

## Failure policy

If any required service restarts during a real task, do not treat the route
result as valid. Mark the task as failed or recoverable based on saved state.
