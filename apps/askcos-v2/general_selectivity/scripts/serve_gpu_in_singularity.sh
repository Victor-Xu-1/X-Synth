#!/bin/bash

singularity instance start -f -c -w --nv general_selectivity_gpu.sif general_selectivity
nohup \
singularity exec -f -c -w --nv instance://general_selectivity \
  bash -c "cd /app/general_selectivity && python general_selectivity_server.py" \
&>/dev/null &
