#!/bin/bash

singularity instance start --nv fast_filter_gpu.sif fast_filter
nohup \
singularity run -f -c -w --nv instance://fast_filter \
&>/dev/null &
