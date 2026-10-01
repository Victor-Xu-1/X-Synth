#!/bin/bash

IFS=","

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

export DATA_NAME="USPTO_50k"

export ALL_REACTION_FILE=$PWD/data/$DATA_NAME/raw/raw_all.csv
export NUM_CORES=32

mkdir -p "$PWD/logs"

for args in \
  1 \
  2 \
  4 \
  8 \
  16 \
  32; \
  do set -- $args;
  export PARTITION=$1;
  docker run --rm \
    -v "$PWD/logs":/app/template_relevance/logs \
    -v "$ALL_REACTION_FILE":/app/template_relevance/data/tmp_for_docker/raw_all.csv \
    -t "${ASKCOS_REGISTRY}"/retro/template_relevance:1.0-gpu \
    python debug_template_extraction.py \
      --data_name="$DATA_NAME" \
      --log_file="debug_template_extraction_${DATA_NAME}_${PARTITION}" \
      --all_reaction_file=/app/template_relevance/data/tmp_for_docker/raw_all.csv \
      --num_cores="$NUM_CORES" \
      --partition="$PARTITION"
  done;
