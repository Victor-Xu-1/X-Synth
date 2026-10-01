#!/bin/bash

singularity instance start pathway_ranker_cpu.sif pathway_ranker
nohup \
singularity exec instance://pathway_ranker \
    python pathway_ranker_server.py \
&>/dev/null &
