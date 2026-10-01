# WLN Atom Mapper

---
Serving module for WLN atom mapper

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
(CPU) docker build -f Dockerfile_wln_cpu -t ${ASKCOS_REGISTRY}/atom_map/wln:1.0-cpu .
(GPU) docker build -f Dockerfile_wln_gpu -t ${ASKCOS_REGISTRY}/atom_map/wln:1.0-gpu .
```

### Using Singularity

- Only option: build from local
```
(CPU) singularity build -f wln_mapper_cpu.sif singularity_wln_cpu.def
(GPU) singularity build -f wln_mapper_gpu.sif singularity_wln_gpu.def
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
(Docker)        docker stop atom_map_wln
(Singularity)   singularity instance stop atom_map_wln
```

## Step 3: Query the Service
Sample Query
```
curl http://0.0.0.0:9651/wln_mapper \
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
    "results":["[CH3:1][CH:2]([CH3:3])[SH:4].[CH3:5][N:6]([CH3:7])[CH:8]=[O:9].[F:10][c:11]1[cH:12][cH:13][cH:14][n:15][c:16]1[F:17].[K+:22].[K+:23].[O:18]=[C:19]([O-:20])[O-:21]>>[CH3:1][CH:2]([CH3:3])[S:4][c:16]1[c:11]([F:10])[cH:12][cH:13][cH:14][n:15]1",
                "[CH2:1]1[CH2:2][O:3][CH2:4][CH2:5][O:6]1.[CH3:7][C:8]([CH3:9])([CH3:10])[O:11][C:12](=[O:13])[CH2:14][O:15][NH:16][C:17](=[O:18])[NH:19][CH2:20][c:21]1[cH:22][cH:23][cH:24][c:25]2[cH:26][cH:27][cH:28][cH:29][c:30]12.[ClH:31]>>[O:11]=[C:12]([OH:13])[CH2:14][O:15][NH:16][C:17](=[O:18])[NH:19][CH2:20][c:21]1[cH:22][cH:23][cH:24][c:25]2[cH:26][cH:27][cH:28][cH:29][c:30]12"]
}
```
