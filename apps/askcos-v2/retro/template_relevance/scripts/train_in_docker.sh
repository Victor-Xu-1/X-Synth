#!/bin/bash

export BATCH_SIZE=1024
export NUM_NODES=1
export NUM_GPU=1
export DROPOUT=0.3
export LR=0.001

docker run --rm --shm-size=5gb --gpus '"device=0"' \
  -v "$PWD/logs":/app/template_relevance/logs \
  -v "$PWD/checkpoints":/app/template_relevance/checkpoints \
  -v "$PWD/results":/app/template_relevance/results \
  -v "$PROCESSED_DATA_PATH":/app/template_relevance/data/tmp_for_docker/processed \
  -v "$MODEL_PATH":/app/template_relevance/checkpoints/tmp_for_docker \
  -t "${ASKCOS_REGISTRY}"/retro/template_relevance:1.0-gpu \
  python templ_rel_trainer.py \
  --backend=nccl \
  --model_name="template_relevance" \
  --data_name="$DATA_NAME" \
  --log_file="template_relevance_train_$DATA_NAME" \
  --processed_data_path=/app/template_relevance/data/tmp_for_docker/processed \
  --model_path=/app/template_relevance/checkpoints/tmp_for_docker \
  --dropout="$DROPOUT" \
  --seed=42 \
  --epochs=30 \
  --hidden_sizes=1024,1024 \
  --learning_rate="$LR" \
  --train_batch_size=$((BATCH_SIZE / NUM_NODES / NUM_GPU)) \
  --val_batch_size=$((BATCH_SIZE / NUM_NODES / NUM_GPU)) \
  --test_batch_size=$((BATCH_SIZE / NUM_NODES / NUM_GPU)) \
  --num_cores="$NUM_CORES" \
  --lr_scheduler_factor 0.3 \
  --lr_scheduler_patience 1
  # --early_stop \
  # --early_stop_patience 2
