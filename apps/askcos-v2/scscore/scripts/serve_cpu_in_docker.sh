#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^scscore$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm scscore
fi

docker run -d \
  --name scscore \
  -p 9741:9741 \
  ${ASKCOS_REGISTRY}/scscore:1.0-cpu
