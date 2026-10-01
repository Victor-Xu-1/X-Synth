# AiZynthFinder Migration

Source: `/home/victor_1/DeepRetro/aizynthfinder`
Target: `/home/victor_1/synon-retrosynthesis-platform/engines/aizynthfinder`

AiZynthFinder is migrated as a secondary route generation engine. ASKCOS remains the primary application and result-history owner.

## Current Model Assets

| Model | Status | Notes |
|---|---|---|
| `USPTO` | available | Local ONNX expansion, ringbreaker, filter, template CSV, and ZINC stock files are present under `engines/aizynthfinder/models`. |
| `Pistachio_100+` | not enabled | Licensed assets are not present at `engines/aizynthfinder/models/Pistachio_100+/config.yml`; the adapter must fail instead of falling back to USPTO. |

The active configs under `engines/aizynthfinder/models` use absolute paths inside `/home/victor_1/synon-retrosynthesis-platform`. They must not point back to `/home/victor_1/DeepRetro`.

## Runner

Run one real smoke case from the project root:

```bash
PYTHONPATH=. python3 scripts/diagnostics/run_aizynthfinder_case.py \
  --smiles 'CCOC(=O)c1ccccc1' \
  --id ethyl_benzoate \
  --model USPTO \
  --timeout-sec 1800
```

The diagnostic runner uses `/home/victor_1/miniconda3/bin/conda run --no-capture-output -n deepretro python` and writes artifacts to `tests/real-cases/runs/`.

For every successful run it now writes three files:

| File | Purpose |
|---|---|
| `result.json` | Raw AiZynthFinder route-tree output |
| `unified_routes.json` | All AiZynthFinder routes normalized into the shared `RouteCandidate` schema |
| `selected_routes.json` | The 3-10 route-family-deduplicated candidates selected by `UnifiedRoutePool` |

This is the live file contract for the next integration step. ASKCOS UI/history
does not yet consume these selected routes directly.

`scripts/diagnostics/build_unified_route_pool.py` can now merge those
AiZynthFinder routes with completed ASKCOS Mongo results for the same target.
The merged selector is engine-diverse: when both engines have closed routes and
unique route families, the selected 3-10 candidates include representation from
both engines.
