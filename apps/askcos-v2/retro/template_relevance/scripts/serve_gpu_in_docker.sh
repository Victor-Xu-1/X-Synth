#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^retro_template_relevance$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm retro_template_relevance
fi

docker run -d --gpus '"device=0"' \
  --name retro_template_relevance \
  -p 9410-9412:9410-9412 \
  -v "$PWD/mars":/app/template_relevance/mars \
  -t "${ASKCOS_REGISTRY}"/retro/template_relevance:1.0-gpu \
  torchserve \
  --start \
  --foreground \
  --ncs \
  --model-store=/app/template_relevance/mars \
  --models \
  bkms_metabolic=bkms_metabolic.mar \
  cas=cas.mar \
  pistachio=pistachio.mar \
  pistachio_ringbreaker=pistachio_ringbreaker.mar \
  reaxys=reaxys.mar \
  reaxys_biocatalysis=reaxys_biocatalysis.mar \
  uspto_higher_level=uspto_higher_level.mar \
  --ts-config ./config.properties
