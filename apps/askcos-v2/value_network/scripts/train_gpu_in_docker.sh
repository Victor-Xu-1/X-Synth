#!/bin/bash

export CUDA_VISIBLE_DEVICES=0
export TRAIN_FILE=$PWD/data/$DATA_NAME/processed/train_out.npz
export VAL_FILE=$PWD/data/$DATA_NAME/processed/val_out.npz
export CHECKPOINT_FOLDER=$PWD/checkpoints/$DATA_NAME/

docker run --rm --gpus '"device=0"' \
    -v "$TRAIN_FILE":/app/value_network/data/tmp_for_docker/processed/train_out.npz \
    -v "$VAL_FILE":/app/value_network/data/tmp_for_docker/processed/val_out.npz \
    -v "$PROCESSED_DATA_PATH":/app/value_network/data/tmp_for_docker/processed \
    -v "$CHECKPOINT_FOLDER":/app/value_network/data/tmp_for_docker/checkpoints \
    -t "${ASKCOS_REGISTRY}"/value_network:1.0-gpu \
    python train.py \
    --train_file=/app/value_network/data/tmp_for_docker/processed/train_out.npz \
    --val_file=/app/value_network/data/tmp_for_docker/processed/val_out.npz \
    --processed_folder=/app/value_network/data/tmp_for_docker/processed \
    --checkpoints_folder=/app/value_network/data/tmp_for_docker/checkpoints \
    --num_cores=$NUM_CORES \
    --n_layers=6 \
    --fp_dim=2048 \
    --latent_dim=128 \
    --batch_size=8192 \
    --dropout=0.1 \
    --n_epochs=100 \
    --lr=5e-3 \
    --save_epoch_int=10 \
