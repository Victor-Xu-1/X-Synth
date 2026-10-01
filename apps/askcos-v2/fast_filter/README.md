# Fast Filter

---
Serving module for fast filter. Models are released under the same license as the source code (MIT license).

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
(CPU) docker build -f Dockerfile_ff_cpu -t ${ASKCOS_REGISTRY}/fast_filter:1.0-cpu .
(GPU) docker build -f Dockerfile_ff_gpu -t ${ASKCOS_REGISTRY}/fast_filter:1.0-gpu .
```

### Using Singularity 

- Only option: build from local
```
(CPU) singularity build -f fast_filter_cpu.sif singularity_ff_cpu.def
(GPU) singularity build -f fast_filter_gpu.sif singularity_ff_gpu.def
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
(Docker)        docker stop fast_filter
(Singularity)   singularity instance stop fast_filter
```

## Step 3: Query the Service

- Sample query 1 (without threshold)
```
curl http://0.0.0.0:9611/fast_filter_evaluate \
	--header "Content-Type: application/json" \
	--request POST \
	--data '{"smiles": ["[CH3:1][C:2](=[O:3])[O:4][CH:5]1[CH:6]([O:7][C:8]([CH3:9])=[O:10])[CH:11]([CH2:12][O:13][C:14]([CH3:15])=[O:16])[O:17][CH:18]([O:19][CH2:20][CH2:21][CH2:22][CH2:23][CH2:24][CH2:25][CH2:26][CH2:27][CH2:28][CH3:29])[CH:30]1[O:31][C:32]([CH3:33])=[O:34].[CH3:35][O-:36].[CH3:38][OH:39].[Na+:37]",
	"CCCCCCCCCCOC1OC(CO)C(O)C(O)C1O"]}'
```

- Sample response 1
```
{
    "status":"SUCCESS",
    "error":"",
    "results":[[[{
                "rank":1.0,"outcome":{"smiles":"CCCCCCCCCCOC1OC(CO)C(O)C(O)C1O","
                template_ids":[],"num_examples":0},
                "score":0.9983257055282593,
                "prob":0.9983257055282593}]]]
}
```

- Sample query 2 (with threshold)
```
curl http://0.0.0.0:9611/filter_with_threshold \
	--header "Content-Type: application/json" \
	--request POST \
	--data '{"smiles": ["CCO.CC(=O)O", "CCOC(=O)C"], "threshold": 0.75}'
```

- Sample response 2
```
{
    "status":"SUCCESS",
    "error":"",
    "results":[{"flag":true,"score":0.9789425730705261}]
}
```

## Unit Test

Requirement: `requests` and `pytest` libraries (pip installable)

With the service started, run
```
pytest
```
