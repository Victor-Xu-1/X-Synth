#!/bin/bash

export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2

export DATA_NAME="cas"
export PROCESSED_DATA_PATH=$PWD/data/$DATA_NAME/processed
export MODEL_PATH=$PWD/checkpoints/$DATA_NAME
export CHECKPOINT_PATH=$MODEL_PATH/model.2520000_251.pt

export EXTRA_FILES="\
models.zip,\
utils.zip,\
train.py,\
/app/graph2smiles/checkpoints/model.pt,\
/app/graph2smiles/data/processed/vocab.txt,\
predict.py\
"

zip models.zip models/*
zip utils.zip utils/*

docker run --rm \
  -v "$PROCESSED_DATA_PATH":/app/graph2smiles/data/processed \
  -v "$CHECKPOINT_PATH":/app/graph2smiles/checkpoints/model.pt \
  -v "$PWD/models.zip":/app/graph2smiles/models.zip \
  -v "$PWD/utils.zip":/app/graph2smiles/utils.zip \
  -v "$PWD/mars":/app/graph2smiles/mars \
  -t "${ASKCOS_REGISTRY}"/forward_predictor/graph2smiles:1.0-gpu \
  torch-model-archiver \
  --model-name=$DATA_NAME \
  --version=1.0 \
  --handler=/app/graph2smiles/handler.py \
  --extra-files="$EXTRA_FILES" \
  --export-path=/app/graph2smiles/mars \
  --force
