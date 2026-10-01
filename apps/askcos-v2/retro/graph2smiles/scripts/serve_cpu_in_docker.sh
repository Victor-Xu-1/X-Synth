#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^retro_graph2smiles$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm retro_graph2smiles
fi

docker run -d \
  --name retro_graph2smiles \
  -p 9430-9432:9430-9432 \
  -v "$PWD/mars":/app/graph2smiles/mars \
  -t "${ASKCOS_REGISTRY}"/retro/graph2smiles:1.0-cpu \
  torchserve \
  --start \
  --foreground \
  --ncs \
  --model-store=/app/graph2smiles/mars \
  --models \
  pistachio_23Q3=pistachio_23Q3.mar \
  USPTO_FULL=USPTO_FULL.mar \
  cas=cas.mar \
  --ts-config ./config.properties
