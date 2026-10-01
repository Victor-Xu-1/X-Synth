#!/bin/bash

singularity instance start --nv rxnmapper_gpu.sif atom_map_rxnmapper
nohup \
singularity exec --nv instance://atom_map_rxnmapper \
  python rxnmapper_server.py \
&>/dev/null &
