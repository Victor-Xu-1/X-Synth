#!/bin/bash

singularity instance start general_selectivity_cpu.sif general_selectivity
nohup \
singularity exec instance://general_selectivity \
  python general_selectivity_server.py \
&>/dev/null &
