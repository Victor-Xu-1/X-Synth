#!/bin/bash

singularity instance start value_network_cpu.sif value_network
nohup \
singularity exec instance://value_network \
  torchserve \
  --start \
  --foreground \
  --ncs \
  --model-store=./mars \
  --models \
  cas=cas.mar \
  --ts-config ./config.properties \
&>/dev/null &
