#!/bin/bash

singularity instance start -f -c -w --nv site_selectivity_gpu.sif site_selectivity
nohup \
singularity exec -f -c -w --nv instance://site_selectivity \
  bash -c "cd /app/site_selectivity && python site_selectivity_server.py" \
&>/dev/null &
