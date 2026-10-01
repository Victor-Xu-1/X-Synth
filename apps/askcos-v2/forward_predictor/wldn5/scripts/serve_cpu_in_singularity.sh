#!/bin/bash

singularity instance start forward_wldn5_cpu.sif forward_wldn5
nohup \
singularity exec instance://forward_wldn5 \
  python wldn5_server.py \
&>/dev/null &
