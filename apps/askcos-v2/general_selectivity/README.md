
# General Selectivity

---
Serving module for general selectivity. Models are released under the same license as the source code (MIT license).

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
(CPU) docker build -f Dockerfile_gs_cpu -t ${ASKCOS_REGISTRY}/general_selectivity:1.0-cpu .
(GPU) docker build -f Dockerfile_gs_gpu -t ${ASKCOS_REGISTRY}/general_selectivity:1.0-gpu .
```

### Using Singularity 

- Only option: build from local
```
(CPU) singularity build -f general_selectivity_cpu.sif singularity_gs_cpu.def
(GPU) singularity build -f general_selectivity_gpu.sif singularity_gs_gpu.def
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
(Docker)        docker stop general_selectivity
(Singularity)   singularity instance stop general_selectivity
```

## Step 3: Query the Service
Sample Query 1 (GnnGeneralSelectivityPredictor)
```
curl http://0.0.0.0:9641/general_selectivity \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"smiles": "CC(COc1n[nH]cc1)C.CC(C)(OC(c1c(Cl)nc(Cl)cc1)=O)C>>CC(OC(c1ccc(n2ccc(OCC(C)C)n2)nc1Cl)=O)(C)C"}'

```
Sample response 1
```
{
    "status":"SUCCESS",
    "error":"",
    "results":[[{"smiles":"CC(C)COc1ccn(-c2ccc(C(=O)OC(C)(C)C)c(Cl)n2)n1","prob":0.9992892742156982,"rank":1},
    {"smiles":"CC(C)COc1ccn(-c2nc(Cl)ccc2C(=O)OC(C)(C)C)n1","prob":0.0007107486017048359,"rank":2}]]
}
```

Sample Query 2 (QmGnnGeneralSelectivityPredictor)
```
curl http://0.0.0.0:9641/qm_predictor \
	--header "Content-Type: application/json" \
	--request POST \
	--data '{"smiles": "CC(COc1n[nH]cc1)C.CC(C)(OC(c1c(Cl)nc(Cl)cc1)=O)C>>CC(OC(c1ccc(n2ccc(OCC(C)C)n2)nc1Cl)=O)(C)C"}'

```
Sample response 2
```
{
    "status":"SUCCESS",
    "error":"",
    "results":[[{"smiles":"CC(C)COc1ccn(-c2ccc(C(=O)OC(C)(C)C)c(Cl)n2)n1","prob":0.9945518374443054,"rank":1},
    {"smiles":"CC(C)COc1ccn(-c2nc(Cl)ccc2C(=O)OC(C)(C)C)n1","prob":0.005448223557323217,"rank":2}]]
}
```

Sample Query 3 (QmGnnGeneralSelectivityPredictorNoReagent)
```
curl http://0.0.0.0:9641/qm_no_reagent \
	--header "Content-Type: application/json" \
	--request POST \
	--data '{"smiles": "CC(COc1n[nH]cc1)C.CC(C)(OC(c1c(Cl)nc(Cl)cc1)=O)C>>CC(OC(c1ccc(n2ccc(OCC(C)C)n2)nc1Cl)=O)(C)C"}'

```
Sample response 3
```
{
    "status":"SUCCESS",
    "error":"",
    "results":[[{"smiles":"CC(C)COc1ccn(-c2ccc(C(=O)OC(C)(C)C)c(Cl)n2)n1","prob":0.9992055296897888,"rank":1},
                {"smiles":"CC(C)COc1ccn(-c2nc(Cl)ccc2C(=O)OC(C)(C)C)n1","prob":0.0007944627432152629,"rank":2}]]
}
```

## Unit Test (Current Unit Testing file is copied from askcos-core)
Requirement: `requests` and `pytest` libraries (pip installable)

With the service started, run
```
pytest
```

