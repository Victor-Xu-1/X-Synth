#!/bin/bash

singularity instance start impurity_cpu.sif impurity_predictor
nohup \
singularity exec instance://impurity_predictor \
  python impurity_server.py \
&>/dev/null &
