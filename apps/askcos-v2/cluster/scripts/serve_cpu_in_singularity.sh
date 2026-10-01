#!/bin/bash

singularity instance start cluster_cpu.sif cluster
nohup \
singularity exec instance://cluster \
  python cluster_reactions_server.py \
&>/dev/null &
