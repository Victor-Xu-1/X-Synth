#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

export CHECKPOINT="epoch_99.pt"
export DATA_NAME="USPTO_FULL"
export EXTRA_FILES="\
/app/value_network/utils.py,\
/app/value_network/checkpoints/$DATA_NAME/$CHECKPOINT,\
/app/value_network/parse_args.py\
"

docker run --rm \
  -v "$PWD/checkpoints/$DATA_NAME/$CHECKPOINT":/app/value_network/checkpoints/$DATA_NAME/$CHECKPOINT \
  -v "$PWD/route/utils.py":/app/value_network/utils.py \
  -v "$PWD/model/value_mlp.py":/app/value_network/value_mlp.py \
  -v "$PWD/model/parse_args.py":/app/value_network/parse_args.py \
  -v "$PWD/mars":/app/value_network/mars \
  -t "${ASKCOS_REGISTRY}"/value_network:1.0-gpu \
  torch-model-archiver \
  --model-name=USPTO_FULL \
  --model-file=/app/value_network/value_mlp.py \
  --version=1.0 \
  --handler=/app/value_network/handler.py \
  --extra-files="$EXTRA_FILES" \
  --export-path=/app/value_network/mars \
  --force