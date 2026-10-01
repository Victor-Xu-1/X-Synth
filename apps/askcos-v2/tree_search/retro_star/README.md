# Retro*

---
Serving module for Retro* searcher, adapted from the [original implementation](https://github.com/binghong-ml/retro_star) and [FusionRetro](https://github.com/SongtaoLiu0823/FusionRetro)

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/tree_search/retro_star:1.0-cpu .
```

### Using Singularity

- Only option: build from local
```
singularity build -f retro_star_cpu.sif singularity_cpu.def
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
(Docker)        docker stop retro_star
(Singularity)   singularity instance stop retro_star
```

## Step 3: Query the Service
Note that the retro_star service depends on the API gateway in askcos2_core (quite a number of services). Therefore, the query would only work if the API gateway (with the backend services) has been started.

Sample Query
```
curl http://0.0.0.0:9321/get_buyable_paths \
	--header "Content-Type: application/json" \
	--request POST \
	--data '{"smiles": "CC(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1"}'

```
Sample response
```
TOO LONG TO SHOW
```
