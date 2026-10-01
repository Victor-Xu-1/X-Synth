#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

RETRO_TEMPLATE_RELEVANCE_HOST_PORT_BASE="${RETRO_TEMPLATE_RELEVANCE_HOST_PORT_BASE:-19410}"
RETRO_TEMPLATE_RELEVANCE_CONTAINER_PORT_BASE="${RETRO_TEMPLATE_RELEVANCE_CONTAINER_PORT_BASE:-9410}"
RETRO_TEMPLATE_RELEVANCE_HOST_PORT_END=$((RETRO_TEMPLATE_RELEVANCE_HOST_PORT_BASE + 2))
RETRO_TEMPLATE_RELEVANCE_CONTAINER_PORT_END=$((RETRO_TEMPLATE_RELEVANCE_CONTAINER_PORT_BASE + 2))

if [ "$(docker ps -aq -f status=exited -f name=^retro_template_relevance$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm retro_template_relevance
fi

docker run -d \
  --name retro_template_relevance \
  -p "${RETRO_TEMPLATE_RELEVANCE_HOST_PORT_BASE}-${RETRO_TEMPLATE_RELEVANCE_HOST_PORT_END}:${RETRO_TEMPLATE_RELEVANCE_CONTAINER_PORT_BASE}-${RETRO_TEMPLATE_RELEVANCE_CONTAINER_PORT_END}" \
  -v "$PWD/mars":/app/template_relevance/mars \
  -v "$PWD/scripts/start_torchserve.sh":/app/template_relevance/scripts/start_torchserve.sh:ro \
  "${ASKCOS_REGISTRY}"/retro/template_relevance:1.0-cpu \
  /bin/bash \
  ./scripts/start_torchserve.sh
