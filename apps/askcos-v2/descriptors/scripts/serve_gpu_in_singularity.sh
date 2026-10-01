#!/bin/bash

singularity instance start --nv descriptors_gpu.sif descriptors
nohup \
singularity exec --nv instance://descriptors \
    python descriptor_server.py \
&>/dev/null &
