#!/bin/bash

IFS=","

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

export DATA_NAME="USPTO_50k"

export ALL_REACTION_FILE=$PWD/data/$DATA_NAME/raw/raw_all.csv
export INTERMEDIATE_FILE=$ALL_REACTION_FILE.extracted.no_store.csv
touch "$INTERMEDIATE_FILE"
export NUM_CORES=8

mkdir -p "$PWD/logs"

docker run --rm \
    -v "$PWD/logs":/app/template_relevance/logs \
    -v "$ALL_REACTION_FILE":/app/template_relevance/data/tmp_for_docker/raw_all.csv \
    -v "$INTERMEDIATE_FILE":/app/template_relevance/data/tmp_for_docker/raw_all.csv.extracted.no_store.csv \
    -t "${ASKCOS_REGISTRY}"/retro/template_relevance:1.0-gpu \
    python debug_template_extraction_file_based.py \
      --data_name="$DATA_NAME" \
      --log_file="debug_template_extraction_file_based_${DATA_NAME}_no_store" \
      --all_reaction_file=/app/template_relevance/data/tmp_for_docker/raw_all.csv \
      --num_cores="$NUM_CORES"

docker run --rm \
    -v "$PWD/logs":/app/template_relevance/logs \
    -v "$ALL_REACTION_FILE":/app/template_relevance/data/tmp_for_docker/raw_all.csv \
    -t "${ASKCOS_REGISTRY}"/retro/template_relevance:1.0-gpu \
    python debug_template_extraction_file_based.py \
      --data_name="$DATA_NAME" \
      --log_file="debug_template_extraction_file_based_${DATA_NAME}" \
      --all_reaction_file=/app/template_relevance/data/tmp_for_docker/raw_all.csv \
      --num_cores="$NUM_CORES" \
      --store_rxn
