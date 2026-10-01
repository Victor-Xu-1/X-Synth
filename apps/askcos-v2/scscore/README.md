# SCScore

---
Serving module for SCScore. Models are released under the same license as the source code (MIT license).

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/scscore:1.0-cpu .
```

### Using Singularity 

- Only option: build from local
```
singularity build -f scscore_cpu.sif singularity_cpu.def
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
(Docker)        docker stop scscore
(Singularity)   singularity instance stop scscore
```

## Step 3: Query the Service
Sample Query 
```
        
curl http://0.0.0.0:9741/scscore \
        --header "Content-Type: application/json" \
        --request POST  \
        --data '{"smiles": "CCCOCCC"}'


```
Sample response 
```
{
  "status": "SUCCESS",
  "error": "",
  "results": float
}
```