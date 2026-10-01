# ExactMatch

Serving modules for one-step retrosynthesis by exact match.

## Serving

### Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```
Then follow the instructions below to use Docker.

#### Using Docker

- Only option: build from local
```
docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/retro/exact_match:1.0-cpu .
```

### Step 2: Start the Service

#### Using Docker

```
sh scripts/serve_cpu_in_docker.sh
```

Note that these scripts start the service in the background (i.e., in detached mode). So they would need to be explicitly stopped if no longer in use
```
(Docker)        docker stop retro_exact_match
```

### Step 3: Query the Service
Note that the `retro_exact_match` service depends on the API gateway in askcos2_core, as it needs to access the reaction collection(s) via the gateway. Therefore, the query would only work if the API gateway has been started.

- Sample query
```
curl http://0.0.0.0:9451/predictions \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"smiles": ["CN(C)CCOC(c1ccccc1)c1ccccc1"],
    "reaction_set": "USPTO_FULL" }'
```
- Sample response
```
List of
{
    "reactants": List[str],
    "scores": List[float],
    "reaction_ids": List[str],
    "reaction_sets": List[str],
    "reaction_data": List[dict]
},
```
