#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^value_network$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm value_network
fi

docker run -d \
  --name value_network \
  -p 9350-9352:9350-9352 \
  -v "$PWD/mars":/app/value_network/mars \
  -t "${ASKCOS_REGISTRY}"/value_network:1.0-cpu \
  torchserve \
  --start \
  --foreground \
  --ncs \
  --model-store=/app/value_network/mars \
  --models \
  USPTO_FULL=USPTO_FULL.mar \
  --ts-config ./config.properties
