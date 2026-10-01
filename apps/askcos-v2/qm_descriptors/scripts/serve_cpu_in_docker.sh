#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^qm_descriptors$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm qm_descriptors
fi

docker run -d \
  --name qm_descriptors \
  -p 9711:9711 \
  -v "$PWD/models":/app/qm_descriptors/models \
  -t ${ASKCOS_REGISTRY}/qm_descriptors:1.0-cpu
