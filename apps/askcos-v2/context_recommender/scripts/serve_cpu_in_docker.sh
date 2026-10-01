#!/bin/bash

if [ -z "${ASKCOS_REGISTRY}" ]; then
  export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
fi

if [ "$(docker ps -aq -f status=exited -f name=^context_recommender$)" ]; then
  # cleanup if container died;
  # otherwise it would've been handled by make stop already
  docker rm context_recommender
fi

docker run -d \
  --name context_recommender \
  -p 9901:9901 \
  -v "$PWD/app/resources":/app/context_recommender/app/resources \
  -t ${ASKCOS_REGISTRY}/context_recommender:1.0-cpu
