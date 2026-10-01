#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^fastsolv$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm fastsolv
fi

docker run -d --gpus '"device=0"' \
  --name fastsolv \
  -p 9761:9761 \
  -t ${ASKCOS_REGISTRY}/fastsolv:1.0-gpu
