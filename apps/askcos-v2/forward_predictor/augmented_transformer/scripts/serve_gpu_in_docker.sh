#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^forward_augmented_transformer$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm forward_augmented_transformer
fi

docker run -d --gpus '"device=0"' \
  --name forward_augmented_transformer \
  -p 9510-9512:9510-9512 \
  -v "$PWD/mars":/app/augmented_transformer/mars \
  -t "${ASKCOS_REGISTRY}"/forward_predictor/augmented_transformer:1.0-gpu \
  torchserve \
  --start \
  --foreground \
  --ncs \
  --model-store=/app/augmented_transformer/mars \
  --models \
  pistachio_23Q3=pistachio_23Q3.mar \
  USPTO_STEREO=USPTO_STEREO.mar \
  cas=cas.mar \
  --ts-config ./config.properties
