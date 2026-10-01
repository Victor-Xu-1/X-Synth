#!/bin/bash
IFS=","

archive_in_docker() {
  echo "Archiving for model $MODEL_NAME"
  docker run --rm \
  -v "$PWD"/tmp/legacy_v2/retro.templates."$MODEL_NAME".jsonl:/app/template_relevance/data/processed/templates.jsonl \
  -v "$PWD"/tmp/legacy_v2/"$MODEL_NAME".pt:/app/template_relevance/checkpoints/model_latest.pt \
  -v "$PWD/mars":/app/template_relevance/mars \
  -t "${ASKCOS_REGISTRY}"/retro/template_relevance:1.0-gpu \
  torch-model-archiver \
  --model-name="$MODEL_NAME" \
  --version=1.0 \
  --handler=/app/template_relevance/templ_rel_handler.py \
  --extra-files="$EXTRA_FILES" \
  --export-path=/app/template_relevance/mars \
  --force
}

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

export EXTRA_FILES="\
misc.py,\
models.py,\
templ_rel_parser.py,\
/app/template_relevance/checkpoints/model_latest.pt,\
/app/template_relevance/data/processed/templates.jsonl,\
utils.py\
"
mkdir -p mars

for args in \
  bkms_metabolic \
  cas \
  pistachio \
  pistachio_ringbreaker \
  reaxys \
  reaxys_biocatalysis
  do set -- $args
  export MODEL_NAME=$1
  archive_in_docker
  done
