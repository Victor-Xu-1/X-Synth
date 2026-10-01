#!/bin/bash

singularity instance start --nv value_network_gpu.sif value_network
nohup \
singularity exec --nv instance://value_network \
  torchserve \
  --start \
  --foreground \
  --ncs \
  --model-store=./mars \
  --models \
  cas=cas.mar \
  --ts-config ./config.properties \
&>/dev/null &
