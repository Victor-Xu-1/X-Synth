#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^solubility_fusion_cycle$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm solubility_fusion_cycle
fi

docker run -d \
  --name solubility_fusion_cycle \
  -p 9771:9771 \
  -v "$PWD/trained_models":/app/solubility_fusion_cycle/trained_models \
  -t ${ASKCOS_REGISTRY}/solubility_fusion_cycle:1.0-cpu
