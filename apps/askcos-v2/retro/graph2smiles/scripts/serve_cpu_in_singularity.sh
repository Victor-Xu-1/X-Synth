#!/bin/bash

singularity instance start graph2smiles_cpu.sif retro_graph2smiles
nohup \
singularity exec instance://retro_graph2smiles \
  torchserve \
  --start \
  --foreground \
  --ncs \
  --model-store=./mars \
  --models \
  cas=cas.mar \
  --ts-config ./config.properties \
&>/dev/null &
