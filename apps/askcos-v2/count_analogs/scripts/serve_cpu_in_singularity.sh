#!/bin/bash

singularity instance start count_analogs_cpu.sif count_analogs
nohup \
singularity exec instance://count_analogs \
  python count_analogs_server.py \
&>/dev/null &
