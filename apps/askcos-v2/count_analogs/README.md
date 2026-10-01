
# Count Analogs

---
Serving module for Count Analogs

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
docker build -f Dockerfile_ca_cpu -t ${ASKCOS_REGISTRY}/count_analogs:1.0-cpu .
```

### Using Singularity

- Only option: build from local
```
singularity build -f count_analogs_cpu.sif singularity_ca_cpu.def
```

## Step 2: Start the Service

### Using Docker

```
sh scripts/serve_cpu_in_docker.sh
```
Note that GPU-based container requires a CUDA-enabled GPU and the <a href="https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html">NVIDIA Container Toolkit</a> (or nvidia-docker in the past). By default, the first GPU will be used.

### Using Singularity

```
sh scripts/serve_cpu_in_singularity.sh
```

Note that these scripts start the service in the background (i.e., in detached mode). So they would need to be explicitly stopped if no longer in use
```
(Docker)        docker stop count_analogs
(Singularity)   singularity instance stop count_analogs
```

## Step 3: Query the Service
Sample Query 
```
curl http://0.0.0.0:9911/count_analogs \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"reaction_smiles": ["CC(COc1n[nH]cc1)C.CC(C)(OC(c1c(Cl)nc(Cl)cc1)=O)C>>CC(OC(c1ccc(n2ccc(OCC(C)C)n2)nc1Cl)=O)(C)C"]}'

```
Sample response
```
{
    "status":"SUCCESS",
    "error":"",
    "results":553656
}
```


## Unit Test (Current Unit Testing file is copied from askcos-core)
Requirement: `requests` and `pytest` libraries (pip installable)

With the service started, run
```
pytest
```

