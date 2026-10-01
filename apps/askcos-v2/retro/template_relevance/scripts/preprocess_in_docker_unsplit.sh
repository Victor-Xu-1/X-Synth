#!/bin/bash

IFS=","

SPLIT="8:1:1"

# Loop through the command-line arguments
while [[ $# -gt 0 ]]; do
  key="$1"

  case $key in
    --split_ratio)
      # If the argument is "--split_ratio", store the next argument in SPLIT
      SPLIT="$2"
      shift 2 # Consume both arguments
      ;;
    *)
      # Handle other arguments or options if needed
      shift
      ;;
  esac
done

echo "SPLIT: $SPLIT"

for args in \
  dedup_and_save_reactions \
  compute_and_save_historian \
  extract_templates_for_training \
  filter_and_save_templates_jsonl \
  truncate_all_reactions_and_split \
  featurize; \
  do set -- $args;
  export STAGE=$1;
  docker run --rm \
    -v "$PWD/logs":/app/template_relevance/logs \
    -v "$PWD/checkpoints":/app/template_relevance/checkpoints \
    -v "$PWD/results":/app/template_relevance/results \
    -v "$ALL_REACTION_FILE":/app/template_relevance/data/tmp_for_docker/raw_all.csv \
    -v "$PROCESSED_DATA_PATH":/app/template_relevance/data/tmp_for_docker/processed \
    -t "${ASKCOS_REGISTRY}"/retro/template_relevance:1.0-gpu \
    python templ_rel_preprocessor.py \
      --model_name="template_relevance" \
      --data_name="$DATA_NAME" \
      --log_file="template_relevance_preprocess_$DATA_NAME.$STAGE" \
      --stage="$STAGE" \
      --all_reaction_file=/app/template_relevance/data/tmp_for_docker/raw_all.csv \
      --processed_data_path=/app/template_relevance/data/tmp_for_docker/processed \
      --num_cores="$NUM_CORES" \
      --split_ratio="$SPLIT" \
      --min_freq=5 \
      --seed=42
  done;
