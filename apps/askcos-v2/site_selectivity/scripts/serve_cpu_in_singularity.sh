#!/bin/bash

singularity instance start site_selectivity_cpu.sif site_selectivity
nohup \
singularity run -f -c -w instance://site_selectivity \
&>/dev/null &
