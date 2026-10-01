#!/bin/bash

docker run --rm --gpus '"device=0"' \
  -v "$PWD/logs":/app/template_relevance/logs \
  -v "$PWD/checkpoints":/app/template_relevance/checkpoints \
  -v "$PWD/results":/app/template_relevance/results \
  -v "$PROCESSED_DATA_PATH":/app/template_relevance/data/tmp_for_docker/processed \
  -v "$MODEL_PATH":/app/template_relevance/checkpoints/tmp_for_docker \
  -v "$TEST_OUTPUT_PATH":/app/template_relevance/results/tmp_for_docker \
  -t "${ASKCOS_REGISTRY}"/retro/template_relevance:1.0-gpu \
  python templ_rel_predictor.py \
  --backend=nccl \
  --model_name="template_relevance" \
  --data_name="$DATA_NAME" \
  --log_file="template_relevance_predict_$DATA_NAME" \
  --processed_data_path=/app/template_relevance/data/tmp_for_docker/processed \
  --model_path=/app/template_relevance/checkpoints/tmp_for_docker \
  --test_output_path=/app/template_relevance/results/tmp_for_docker \
  --num_cores="$NUM_CORES" \
  --test_batch_size=256 \
  --topk=10
