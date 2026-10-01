#!/bin/bash

singularity instance start --nv augmented_transformer_gpu.sif forward_augmented_transformer
nohup \
singularity exec --nv instance://forward_augmented_transformer \
  torchserve \
  --start \
  --foreground \
  --ncs \
  --model-store=./mars \
  --models \
  cas=cas.mar \
  --ts-config ./config.properties \
&>/dev/null &
