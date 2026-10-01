# Fastsolv

Serving module for fastsolv solubility prediction.
Models are released under the same license as the source code (MIT license).

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
(CPU) docker build -f Dockerfile_fastsolv_cpu -t ${ASKCOS_REGISTRY}/fastsolv:1.0-cpu .
(GPU) docker build -f Dockerfile_fastsolv_gpu -t ${ASKCOS_REGISTRY}/fastsolv:1.0-gpu .
```

## Step 2: Start the Service

### Using Docker

```
(CPU) sh scripts/serve_cpu_in_docker.sh
(GPU) sh scripts/serve_gpu_in_docker.sh
```
Note that GPU-based container requires a CUDA-enabled GPU and the <a href="https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html">NVIDIA Container Toolkit</a> (or nvidia-docker in the past). By default, the first GPU will be used.

Note that these scripts start the service in the background (i.e., in detached mode). So they would need to be explicitly stopped if no longer in use
```
docker stop fastsolv
```

## Step 3: Query the Service

- Sample query
```
curl http://0.0.0.0:9761/fastsolv \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"solvent_smiles": ["O"], "solute_smiles": ["CCO"], "temperature": [298]}'
```
- Sample response
```
{
    "status": SUCCESS,
    "error": "",
    "results": List[
      {
        "solvent_smiles": str,
        "solute_smiles": str,
        "temperature": float,
        "predicted_logS": float,
        "predicted_logS_stdev": float,
      }
    ]
}
```

The `"results"` list can be loaded as a `pandas.DataFrame` with the `.from_records` method.

## Unit Test

Requirement: `requests` and `pytest` libraries (pip installable)

With the service started, run
```
pytest
```
