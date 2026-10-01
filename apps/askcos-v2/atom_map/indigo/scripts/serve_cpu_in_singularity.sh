#!/bin/bash

singularity instance start indigo_cpu.sif atom_map_indigo
nohup \
singularity exec instance://atom_map_indigo \
  python indigo_server.py \
&>/dev/null &
