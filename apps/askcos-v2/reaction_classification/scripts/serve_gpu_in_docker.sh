#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^reaction_class$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm reaction_class
fi

docker run -d --gpus '"device=0"' \
  --name reaction_class \
  -p 9621:9621 \
  -t ${ASKCOS_REGISTRY}/reaction_classification:1.0-gpu