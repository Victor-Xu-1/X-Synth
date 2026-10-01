#!/bin/bash

export TRAIN_FILE=$PWD/data/$DATA_NAME/raw/raw_train.csv
export VAL_FILE=$PWD/data/$DATA_NAME/raw/raw_val.csv
export TEST_FILE=$PWD/data/$DATA_NAME/raw/raw_test.csv

docker run --rm \
    -v "$TRAIN_FILE":/app/value_network/data/tmp_for_docker/raw_train.csv \
    -v "$VAL_FILE":/app/value_network/data/tmp_for_docker/raw_val.csv \
    -v "$TEST_FILE":/app/value_network/data/tmp_for_docker/raw_test.csv \
    -v "$PROCESSED_DATA_PATH":/app/value_network/data/tmp_for_docker/processed \
    -t "${ASKCOS_REGISTRY}"/value_network:1.0-gpu \
    python preprocess.py \
    --train_file=/app/value_network/data/tmp_for_docker/raw_train.csv \
    --val_file=/app/value_network/data/tmp_for_docker/raw_val.csv \
    --test_file=/app/value_network/data/tmp_for_docker/raw_test.csv \
    --processed_folder=/app/value_network/data/tmp_for_docker/processed \
    --num_cores=$NUM_CORES
