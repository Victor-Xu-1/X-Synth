
# Site Selectivity

---
Serving module for site selectivity. Models are released under the same license as the source code (MIT license)

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
(CPU) docker build -f Dockerfile_site_cpu -t ${ASKCOS_REGISTRY}/site_selectivity:1.0-cpu .
(GPU) docker build -f Dockerfile_site_gpu -t ${ASKCOS_REGISTRY}/site_selectivity:1.0-gpu .
```

### Using Singularity

- Only option: build from local
```
(CPU) singularity build -f site_selectivity_cpu.sif singularity_site_cpu.def
(GPU) singularity build -f site_selectivity_gpu.sif singularity_site_gpu.def
```

## Step 2: Start the Service

### Using Docker

```
(CPU) sh scripts/serve_cpu_in_docker.sh
(GPU) sh scripts/serve_gpu_in_docker.sh
```
Note that GPU-based container requires a CUDA-enabled GPU and the <a href="https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html">NVIDIA Container Toolkit</a> (or nvidia-docker in the past). By default all available GPUs will be used.

### Using Singularity

```
(CPU) sh scripts/serve_cpu_in_singularity.sh
(GPU) sh scripts/serve_gpu_in_singularity.sh
```
Note that these scripts start the service in the background (i.e., in detached mode). So they would need to be explicitly stopped if no longer in use
```
(Docker)        docker stop site_selectivity
(Singularity)   singularity instance stop site_selectivity
```

## Step 3: Query the Service

- Sample query
```
curl http://0.0.0.0:9601/site_selectivity \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"smiles": ["Cc1ccccc1"]}'
```
- Sample response
```
{
    "status": SUCCESS,
    "error": "",
    "results": List of List of
        {
            "smiles": str,
            "index": integer,
            "task": str,
            "atom_scores": List[float]
        }, 
}
```

## Unit Test

Requirement: `requests` and `pytest` libraries (pip installable)

With the service started, run
```
pytest
```
