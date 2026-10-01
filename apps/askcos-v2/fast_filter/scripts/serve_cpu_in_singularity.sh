#!/bin/bash

singularity instance start fast_filter_cpu.sif fast_filter
nohup \
singularity run -f -c -w instance://fast_filter \
&>/dev/null &
