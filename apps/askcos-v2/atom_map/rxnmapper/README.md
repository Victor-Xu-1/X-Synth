# IBM RXNMapper

---
Serving module for IBM RXNMapper

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
(CPU) docker build -f Dockerfile_rxn_cpu -t ${ASKCOS_REGISTRY}/atom_map/rxnmapper:1.0-cpu .
(GPU) docker build -f Dockerfile_rxn_gpu -t ${ASKCOS_REGISTRY}/atom_map/rxnmapper:1.0-gpu .
```

### Using Singularity

- Only option: build from local
```
(CPU) singularity build -f rxnmapper_cpu.sif singularity_rxn_cpu.def
(GPU) singularity build -f rxnmapper_gpu.sif singularity_rxn_gpu.def
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
(Docker)        docker stop atom_map_rxnmapper
(Singularity)   singularity instance stop atom_map_rxnmapper
```

## Step 3: Query the Service
Sample Query
```
curl http://0.0.0.0:9671/ibm_rxnmapper \
	--header "Content-Type: application/json" \
	--request POST \
	--data '{"smiles": ["CC(C)S.CN(C)C=O.Fc1cccnc1F.O=C([O-])[O-].[K+].[K+]>>CC(C)Sc1ncccc1F",
	"C1COCCO1.CC(C)(C)OC(=O)CONC(=O)NCc1cccc2ccccc12.Cl>>O=C(O)CONC(=O)NCc1cccc2ccccc12"]}'

```
Sample response
```
{
    "status":"SUCCESS",
    "error":"",
    "results":[[
                {"confidence":0.9565621510872819,
                "mapped_rxn":"[CH3:1][CH:2]([CH3:3])[SH:4].CN(C)C=O.F[c:5]1[n:6][cH:7][cH:8][cH:9][c:10]1[F:11].O=C([O-])[O-].[K+].[K+]>>[CH3:1][CH:2]([CH3:3])[S:4][c:5]1[n:6][cH:7][cH:8][cH:9][c:10]1[F:11]"},
                {"confidence":0.9704424478656184,
                "mapped_rxn":"C1COCCO1.CC(C)(C)[O:3][C:2](=[O:1])[CH2:4][O:5][NH:6][C:7](=[O:8])[NH:9][CH2:10][c:11]1[cH:12][cH:13][cH:14][c:15]2[cH:16][cH:17][cH:18][cH:19][c:20]12.Cl>>[O:1]=[C:2]([OH:3])[CH2:4][O:5][NH:6][C:7](=[O:8])[NH:9][CH2:10][c:11]1[cH:12][cH:13][cH:14][c:15]2[cH:16][cH:17][cH:18][cH:19][c:20]12"}]]
}
```
