#!/bin/bash

singularity instance start -f -c -w --nv wln_mapper_gpu.sif atom_map_wln
nohup \
singularity exec -f -c -w --nv instance://atom_map_wln \
  bash -c "cd /app/atom_map/wln && python wln_server.py" \
&>/dev/null &
