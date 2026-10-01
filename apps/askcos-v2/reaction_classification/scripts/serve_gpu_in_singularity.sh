#!/bin/bash

singularity instance start -f -c -w --nv reaction_class_gpu.sif reaction_class
nohup \
singularity exec -f -c -w --nv instance://reaction_class \
  bash -c "cd /app/reaction_classification && python reaction_class_server.py" \
&>/dev/null &
