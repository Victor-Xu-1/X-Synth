#!/bin/bash

singularity instance start retro_star_cpu.sif retro_star
nohup \
singularity exec instance://retro_star \
  python retro_star_server.py \
&>/dev/null &
