#!/bin/bash

singularity instance start -f -c -w --nv forward_wldn5_gpu.sif forward_wldn5
nohup \
singularity exec -f -c -w --nv instance://forward_wldn5 \
  bash -c "cd /app/wldn5 && python wldn5_server.py" \
&>/dev/null &
