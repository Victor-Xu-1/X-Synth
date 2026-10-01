#!/bin/bash

singularity instance start descriptors_cpu.sif descriptors
nohup \
singularity exec instance://descriptors \
    python descriptor_server.py \
&>/dev/null &
