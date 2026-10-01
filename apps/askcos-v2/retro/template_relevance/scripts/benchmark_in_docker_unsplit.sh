#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

export DATA_NAME="USPTO_50k"

export ALL_REACTION_FILE=$PWD/data/$DATA_NAME/raw/raw_all.csv
export NUM_CORES=8

export PROCESSED_DATA_PATH=$PWD/data/$DATA_NAME/processed
export MODEL_PATH=$PWD/checkpoints/$DATA_NAME
export TEST_OUTPUT_PATH=$PWD/results/$DATA_NAME

[ -f "$ALL_REACTION_FILE" ] || { echo "$ALL_REACTION_FILE" does not exist; exit; }

mkdir -p "$PROCESSED_DATA_PATH"
mkdir -p "$MODEL_PATH"
mkdir -p "$TEST_OUTPUT_PATH"
mkdir -p "$PWD/logs"
mkdir -p "$PWD/mars"

bash scripts/preprocess_in_docker_unsplit.sh --split_ratio 98:1:1
bash scripts/train_in_docker.sh
bash scripts/predict_in_docker.sh
