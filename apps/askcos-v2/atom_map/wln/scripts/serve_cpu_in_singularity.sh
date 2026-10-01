#!/bin/bash

singularity instance start wln_mapper_cpu.sif atom_map_wln
nohup \
singularity exec instance://atom_map_wln \
  python wln_server.py \
&>/dev/null &
