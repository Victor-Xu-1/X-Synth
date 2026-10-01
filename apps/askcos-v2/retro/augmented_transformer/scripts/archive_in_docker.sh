#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

export EXTRA_FILES="\
/app/augmented_transformer/utils.py,\
/app/augmented_transformer/checkpoints/USPTO_50k/model_step_500000.pt\
"

docker run --rm \
  -v "$PWD/checkpoints/USPTO_50k/model_step_500000.pt":/app/augmented_transformer/checkpoints/USPTO_50k/model_step_500000.pt \
  -v "$PWD/mars":/app/augmented_transformer/mars \
  -t "${ASKCOS_REGISTRY}"/retro/augmented_transformer:1.0-gpu \
  torch-model-archiver \
  --model-name=USPTO_50k \
  --version=1.0 \
  --handler=/app/augmented_transformer/at_handler.py \
  --extra-files="$EXTRA_FILES" \
  --export-path=/app/augmented_transformer/mars \
  --force
