#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^pathway_ranker$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm pathway_ranker
fi

docker run -d --gpus '"device=0"' \
  --name pathway_ranker \
  -p 9681:9681 \
  -t ${ASKCOS_REGISTRY}/pathway_ranker:1.0-gpu
