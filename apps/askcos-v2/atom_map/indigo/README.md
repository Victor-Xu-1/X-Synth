# Indigo Atom Mapper

---
Serving module for indigo atom mapper. This repo relies on the indigo library, which is distributed under the Apache 2.0 license.

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
docker build -f Dockerfile_indigo_cpu -t ${ASKCOS_REGISTRY}/atom_map/indigo:1.0-cpu .
```

### Using Singularity

- Only option: build from local
```
singularity build -f indigo_cpu.sif singularity_indigo_cpu.def
```

## Step 2: Start the Service

### Using Docker

```
sh scripts/serve_cpu_in_docker.sh
```

### Using Singularity

```
sh scripts/serve_cpu_in_singularity.sh
```

Note that these scripts start the service in the background (i.e., in detached mode). So they would need to be explicitly stopped if no longer in use
```
(Docker)        docker stop atom_map_indigo
(Singularity)   singularity instance stop atom_map_indigo
```

## Step 3: Query the Service
Sample Query
```
curl http://0.0.0.0:9661/indigo_mapper \
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
    "results":[["[CH3:1][CH:2]([SH:4])[CH3:3].CN(C=O)C.[F:10][c:11]1[c:16](F)[n:15][cH:14][cH:13][cH:12]1.O=C([O-])[O-].[K+].[K+]>>[CH3:1][CH:2]([S:4][c:16]1[c:11]([F:10])[cH:12][cH:13][cH:14][n:15]1)[CH3:3]",
                "C1[O:6][CH2:5][CH2:4][O:3]C1.CC([O:11]C(CO[NH:16][C:17]([NH:19][CH2:20][c:21]1[c:30]2[c:25]([cH:26][cH:27][cH:28][cH:29]2)[cH:24][cH:23][cH:22]1)=[O:18])=O)(C)C.Cl>>[O:11]=[C:5]([CH2:4][O:3][NH:16][C:17]([NH:19][CH2:20][c:21]1[c:30]2[c:25]([cH:26][cH:27][cH:28][cH:29]2)[cH:24][cH:23][cH:22]1)=[O:18])[OH:6]"]]
}
```
