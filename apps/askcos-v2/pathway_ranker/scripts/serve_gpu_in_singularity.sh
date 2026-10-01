#!/bin/bash

singularity instance start --nv pathway_ranker_gpu.sif pathway_ranker
nohup \
singularity exec --nv instance://pathway_ranker \
    python pathway_ranker_server.py \
&>/dev/null &
