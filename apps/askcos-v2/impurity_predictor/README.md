# impurity

---
Serving module for impuritys

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
docker build -f Dockerfile_impurity_cpu -t ${ASKCOS_REGISTRY}/impurity_predictor:1.0-cpu .
```

### Using Singularity 

- Only option: build from local
```
singularity build -f impurity_cpu.sif singularity_impurity_cpu.def
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
(Docker)        docker stop impurity_predictor
(Singularity)   singularity instance stop impurity_predictor
```

## Step 3: Query the Service
Note that the impurity service depends on the API gateway in askcos2_core (more specifically, on the atom map, forward and fast_filter services). Therefore, the query would only work if the API gateway (with the backend services) has been started.

Sample Query 
```
        
curl http://0.0.0.0:9691/impurity \
        --header "Content-Type: application/json" \
        --request POST  \
        --data '{"rct_smi": "Oc1ccc(Br)cc1.Sc1cccc(Br)c1", 
                 "prd_smi": "",
                 "sol_smi": "",
                 "rea_smi": ""}'


```
Sample response 
```
{
  "status": "SUCCESS",
  "error": "",
  "results": [
    {
      "predict_expand": List[Dict]
      "predict_normal": List[Dict]
    }
}
```