#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^fast_filter$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm fast_filter
fi

docker run -d \
  --name fast_filter \
  -p 9611:9611 \
  ${ASKCOS_REGISTRY}/fast_filter:1.0-cpu
