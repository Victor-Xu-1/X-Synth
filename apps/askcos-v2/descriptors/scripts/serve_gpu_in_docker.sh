#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^descriptors$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm descriptors
fi

docker run -d --gpus '"device=0"' \
  --name descriptors \
  -p 9631:9631 \
  -t ${ASKCOS_REGISTRY}/descriptors:1.0-gpu
