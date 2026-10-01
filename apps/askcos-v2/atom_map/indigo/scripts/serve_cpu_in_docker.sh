#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^atom_map_indigo$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm atom_map_indigo
fi

docker run -d \
  --name atom_map_indigo \
  -p 9661:9661 \
  -t ${ASKCOS_REGISTRY}/atom_map/indigo:1.0-cpu
