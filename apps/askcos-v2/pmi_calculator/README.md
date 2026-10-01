# PMI Calculator 

---
Serving module for pmi calculator

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
docker build -f Dockerfile_pmi_cpu -t ${ASKCOS_REGISTRY}/pmi_calculator:1.0-cpu .
```

### Using Singularity

- Only option: build from local
```
singularity build -f pmi_cpu.sif singularity_pmi_cpu.def
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
(Docker)        docker stop pmi_calculator
(Singularity)   singularity instance stop pmi_calculator
```

## Step 3: Query the Service

Sample Query (to be executed from this folder)
```
curl http://0.0.0.0:9701/pmi_calculator \
	--header "Content-Type: application/json" \
	--request POST \
	--data '@test_data/test_trees.json'
```

#### Note

"test_trees.json" was generated from pmi_caluclator.py file in ASKCOS v1.

Sample response
```
{
    "status":"SUCCESS",
    "error":"",
    "results":[[9.437144474050966,27.16365872380754,25.474038257290644,13.03564170300261,36.32701448166275,23.401709943054264,21.394262512883174,7.574943148092961,52.723270693461814,13.311111460822486,12.296193564420582,76.59032460640528,9.87133955256197,38.45206165206025,7.393957381936222,87.50107662161184,8.728899342556304,36.90556372137062,7.222272107974532,33.1153775964439,132.55209844314467,150.11580116147857,145.49012151420374,138.65099975538558,48.541001428338575,42.925788052559476,138.86333977245272,14.589129820008631,185.22213841134845,49.53197022959652]]
}
```

