#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

export DATA_NAME="USPTO_FULL"
export NUM_CORES=16
export PROCESSED_DATA_PATH=$PWD/data/$DATA_NAME/processed


[ -f $TRAIN_FILE ] || { echo $TRAIN_FILE does not exist; exit; }
[ -f $VAL_FILE ] || { echo $VAL_FILE does not exist; exit; }
[ -f $TEST_FILE ] || { echo $TEST_FILE does not exist; exit; }


bash scripts/preprocess_in_docker.sh
bash scripts/extract_routes_in_docker.sh
# bash scripts/train_cpu_in_docker.sh
bash scripts/train_gpu_in_docker.sh