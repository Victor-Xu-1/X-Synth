# WLDN5 Forward Predictor

---
Serving module for WLN forward predictor. Models are released under the same license as the source code (MIT license).

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
(CPU) docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/forward_predictor/wldn5:1.0-cpu .
(GPU) docker build -f Dockerfile_gpu -t ${ASKCOS_REGISTRY}/forward_predictor/wldn5:1.0-gpu .
```

### Using Singularity

- Only option: build from local
```
(CPU) singularity build -f forward_wldn5_cpu.sif singularity_cpu.def
(GPU) singularity build -f forward_wldn5_gpu.sif singularity_gpu.def
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
(Docker)        docker stop forward_wldn5
(Singularity)   singularity instance stop forward_wldn5
```

## Step 3: Query the Service
Sample Query
```
curl http://0.0.0.0:9501/wldn5_predict \
        --header "Content-Type: application/json" \
        --request POST \
        --data '{"model_name": "uspto_500k", "reactants": "CCCCO.CCCCBr"}'
```
Sample response
```
{
    "status": "SUCCESS",
    "error": "",
    "results": List[List[
        {
            "rank": int,
            "outcome": {
                "smiles": str,
                "template_ids": [],
                "num_examples": 0
            },
            "score": float,
            "prob": float,
            "mol_wt": float
        }
    ]]
}
```
