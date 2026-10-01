#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^site_selectivity$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm site_selectivity
fi

docker run -d --gpus '"device=0"' \
  --name site_selectivity \
  -p 9601:9601 \
  -t ${ASKCOS_REGISTRY}/site_selectivity:1.0-gpu
