#!/bin/bash

# Assign arguments to variables

export TRAIN_RXNS_PATH=$PWD/data/$DATA_NAME/processed/train_rxns.txt
export VAL_RXNS_PATH=$PWD/data/$DATA_NAME/processed/val_rxns.txt
export BB_PATH=$PWD/data/building_blocks/building_blocks.pkl

# Define paths for Docker
TRAIN_FILE="$TRAIN_RXNS_PATH"
VAL_FILE="$VAL_RXNS_PATH"

# Run Docker
docker run --rm \
    -v "$TRAIN_FILE":/app/value_network/data/tmp_for_docker/train_rxns.txt \
    -v "$VAL_FILE":/app/value_network/data/tmp_for_docker/val_rxns.txt \
    -v "$BB_PATH":/app/value_network/data/tmp_for_docker/building_blocks.pkl \
    -v "$PROCESSED_DATA_PATH":/app/value_network/data/tmp_for_docker/processed \
    -t "${ASKCOS_REGISTRY}/value_network:1.0-gpu" \
    python extract_values.py \
    --train_file=/app/value_network/data/tmp_for_docker/train_rxns.txt \
    --val_file=/app/value_network/data/tmp_for_docker/val_rxns.txt \
    --bb_file=/app/value_network/data/tmp_for_docker/building_blocks.pkl \
    --processed_folder=/app/value_network/data/tmp_for_docker/processed \