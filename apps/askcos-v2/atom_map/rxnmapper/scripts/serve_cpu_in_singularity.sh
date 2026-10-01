#!/bin/bash

singularity instance start rxnmapper_cpu.sif atom_map_rxnmapper
nohup \
singularity exec instance://atom_map_rxnmapper \
  python rxnmapper_server.py \
&>/dev/null &
