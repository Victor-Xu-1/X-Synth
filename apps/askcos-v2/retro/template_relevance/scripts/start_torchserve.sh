#!/usr/bin/env bash
set -euo pipefail

cleanup_torchserve_tmp() {
  local tmp_root="${TMPDIR:-/tmp}"

  if [ -z "${tmp_root}" ] || [ ! -d "${tmp_root}" ]; then
    return
  fi

  find "${tmp_root}" -mindepth 1 -maxdepth 1 \
    \( -type d -name "models" -o -type d -name "model*.download" -o -type f -name "model*.download" \) \
    -exec rm -rf {} +
}

cleanup_torchserve_tmp

# Synon route-tree production mode uses these three template relevance models.
# Loading every bundled MAR on WSL can exceed the available memory and kill the
# whole route-search stack. Set TEMPLATE_RELEVANCE_MODELS to override this list
# when a full ASKCOS research deployment explicitly needs more models.
TEMPLATE_RELEVANCE_MODELS="${TEMPLATE_RELEVANCE_MODELS:-reaxys=reaxys.mar pistachio=pistachio.mar uspto_higher_level=uspto_higher_level.mar}"

exec torchserve \
  --start \
  --foreground \
  --ncs \
  --model-store=/app/template_relevance/mars \
  --models \
  ${TEMPLATE_RELEVANCE_MODELS} \
  --ts-config ./config.properties
