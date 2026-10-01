#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^solubility$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm solubility
fi

docker run -d \
  --name solubility \
  -p 9732-9734:9732-9734 \
  -t ${ASKCOS_REGISTRY}/solubility:1.0-cpu \
  torchserve \
  --start \
  --foreground \
  --ts-config /home/askcos/config.properties \
  --models solprop=solprop.mar
