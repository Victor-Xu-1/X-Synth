#!/bin/bash

singularity instance start scscore_cpu.sif scscore
nohup \
singularity exec instance://scscore \
  python scscore_server.py \
&>/dev/null &
