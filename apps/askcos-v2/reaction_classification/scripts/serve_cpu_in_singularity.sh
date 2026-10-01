#!/bin/bash

singularity instance start reaction_class_cpu.sif reaction_class
nohup \
singularity exec instance://reaction_class \
  python reaction_class_server.py \
&>/dev/null &
