#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^atom_map_rxnmapper$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm atom_map_rxnmapper
fi

docker run -d --gpus '"device=0"' \
  --name atom_map_rxnmapper \
  -p 9671:9671 \
  -t ${ASKCOS_REGISTRY}/atom_map/rxnmapper:1.0-gpu
