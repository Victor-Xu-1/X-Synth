#!/bin/bash

singularity instance start --nv template_relevance_gpu.sif retro_template_relevance
nohup \
singularity exec --nv instance://retro_template_relevance \
  torchserve \
  --start \
  --foreground \
  --ncs \
  --model-store=./mars \
  --models \
  bkms_metabolic=bkms_metabolic.mar \
  cas=cas.mar \
  pistachio=pistachio.mar \
  pistachio_ringbreaker=pistachio_ringbreaker.mar \
  reaxys=reaxys.mar \
  reaxys_biocatalysis=reaxys_biocatalysis.mar \
  --ts-config ./config.properties \
&>/dev/null &
