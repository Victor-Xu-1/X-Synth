#!/bin/bash

singularity instance start context_cpu.sif context_recommender
nohup \
singularity exec instance://context_recommender \
  uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 9901 \
&>/dev/null &
