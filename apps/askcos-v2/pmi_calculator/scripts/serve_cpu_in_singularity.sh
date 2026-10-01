#!/bin/bash

singularity instance start pmi_cpu.sif pmi_calculator
nohup \
singularity exec instance://pmi_calculator \
    python pmi_server.py \
&>/dev/null &
