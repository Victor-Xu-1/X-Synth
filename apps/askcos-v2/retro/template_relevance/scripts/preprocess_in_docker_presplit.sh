#!/bin/bash

IFS=","

for args in \
  dedup_and_save_reactions \
  compute_and_save_historian \
  extract_templates_for_training \
  filter_and_save_templates_jsonl \
  truncate_train_reactions_and_extract_val_test \
  featurize; \
  do set -- $args;
  export STAGE=$1;
  docker run --rm \
    -v "$PWD/logs":/app/template_relevance/logs \
    -v "$PWD/checkpoints":/app/template_relevance/checkpoints \
    -v "$PWD/results":/app/template_relevance/results \
    -v "$TRAIN_FILE":/app/template_relevance/data/tmp_for_docker/raw_train.csv \
    -v "$VAL_FILE":/app/template_relevance/data/tmp_for_docker/raw_val.csv \
    -v "$TEST_FILE":/app/template_relevance/data/tmp_for_docker/raw_test.csv \
    -v "$PROCESSED_DATA_PATH":/app/template_relevance/data/tmp_for_docker/processed \
    -t "${ASKCOS_REGISTRY}"/retro/template_relevance:1.0-gpu \
    python templ_rel_preprocessor.py \
      --model_name="template_relevance" \
      --data_name="$DATA_NAME" \
      --log_file="template_relevance_preprocess_$DATA_NAME.$STAGE" \
      --stage="$STAGE" \
      --is_data_presplit \
      --train_file=/app/template_relevance/data/tmp_for_docker/raw_train.csv \
      --val_file=/app/template_relevance/data/tmp_for_docker/raw_val.csv \
      --test_file=/app/template_relevance/data/tmp_for_docker/raw_test.csv \
      --processed_data_path=/app/template_relevance/data/tmp_for_docker/processed \
      --num_cores="$NUM_CORES" \
      --min_freq=5 \
      --seed=42
  done;
