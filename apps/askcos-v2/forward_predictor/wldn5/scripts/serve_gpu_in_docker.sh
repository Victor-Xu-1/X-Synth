#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^forward_wldn5$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm forward_wldn5
fi

docker run -d --gpus '"device=0"' \
  --name forward_wldn5 \
  -p 9501:9501 \
  -t ${ASKCOS_REGISTRY}/forward_predictor/wldn5:1.0-gpu
