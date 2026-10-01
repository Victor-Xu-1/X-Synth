# Descriptor

---
Serving module for descriptors, used as a dependency for and exclusively by the general selectivity predictor. Models are released under the same license as the source code (MIT license).

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
(CPU) docker build -f Dockerfile_desc_cpu -t ${ASKCOS_REGISTRY}/descriptors:1.0-cpu .
(GPU) docker build -f Dockerfile_desc_gpu -t ${ASKCOS_REGISTRY}/descriptors:1.0-gpu .
```

### Using Singularity 

- Only option: build from local
```
(CPU) singularity build -f descriptors_cpu.sif singularity_desc_cpu.def
(GPU) singularity build -f descriptors_gpu.sif singularity_desc_gpu.def
```

## Step 2: Start the Service

### Using Docker

```
(CPU) sh scripts/serve_cpu_in_docker.sh
(GPU) sh scripts/serve_gpu_in_docker.sh
```
Note that GPU-based container requires a CUDA-enabled GPU and the <a href="https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html">NVIDIA Container Toolkit</a> (or nvidia-docker in the past). By default, the first GPU will be used.

### Using Singularity 

```
(CPU) sh scripts/serve_cpu_in_singularity.sh
(GPU) sh scripts/serve_gpu_in_singularity.sh
```

Note that these scripts start the service in the background (i.e., in detached mode). So they would need to be explicitly stopped if no longer in use
```
(Docker)        docker stop descriptors
(Singularity)   singularity instance stop descriptors
```

## Step 3: Query the Service
Sample Query 
```
curl http://0.0.0.0:9631/descriptors \
	--header "Content-Type: application/json" \
	--request POST \
	--data '{"smiles": "CCCC.CCC.CCCCC"}'

```
Sample response 
```
{
    "status":"SUCCESS",
    "error":"",
    "results":[{"smiles":"CCCC",
                "partial_charge":[-0.08191273361444473,-0.042348891496658325,-0.042348891496658325,-0.08191273361444473,0.025421524420380592,0.025421524420380592,0.025421524420380592,0.023998532444238663,0.023998532444238663,0.023998532444238663,0.023998532444238663,0.025421524420380592,0.025421524420380592,0.025421524420380592],
                "fukui_neu":[0.08414475619792938,0.08689119666814804,0.08689119666814804,0.08414475619792938,0.06504063308238983,0.06504063308238983,0.06504063308238983,0.06692109256982803,0.06692109256982803,0.06692109256982803,0.06692109256982803,0.06504063308238983,0.06504063308238983,0.06504063308238983],
                "fukui_elec":[0.0635380893945694,0.06011628732085228,0.06011628732085228,0.0635380893945694,0.07019485533237457,0.07019485533237457,0.07019485533237457,0.08288056403398514,0.08288056403398514,0.08288056403398514,0.08288056403398514,0.07019485533237457,0.07019485533237457,0.07019485533237457],
                "NMR":[174.98739624023438,161.94447326660156,161.94447326660156,174.98739624023438,30.900964736938477,30.900964736938477,30.900964736938477,30.456565856933594,30.456565856933594,30.456565856933594,30.456565856933594,30.900964736938477,30.900964736938477,30.900964736938477],
                "bond_order":[1.030405879020691,1.0142536163330078,1.0302691459655762,0.9394513368606567,0.9394513368606567,0.9394513368606567,0.9201322197914124,0.9201322197914124,0.9201322197914124,0.9201322197914124,0.9394513368606567,0.9394513368606567,0.9394513368606567],
                "bond_length":[1.523678183555603,1.527199387550354,1.5236423015594482,1.0878978967666626,1.0878978967666626,1.0878978967666626,1.0925374031066895,1.0925374031066895,1.0925374031066895,1.0925374031066895,1.0878978967666626,1.0878978967666626,1.0878978967666626]}]
}
```
