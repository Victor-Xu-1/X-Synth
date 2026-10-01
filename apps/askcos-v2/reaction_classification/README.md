# Reaction Classification 

---
Serving module for reaction classification. Models are released under the same license as the source code (MIT license).

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
(CPU) docker build -f Dockerfile_rc_cpu -t ${ASKCOS_REGISTRY}/reaction_classification:1.0-cpu .
(GPU) docker build -f Dockerfile_rc_gpu -t ${ASKCOS_REGISTRY}/reaction_classification:1.0-gpu .
```

### Using Singularity 

- Only option: build from local
```
(CPU) singularity build -f reaction_class_cpu.sif singularity_rc_cpu.def
(GPU) singularity build -f reaction_class_gpu.sif singularity_rc_gpu.def
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
(Docker)        docker stop reaction_class
(Singularity)   singularity instance stop reaction_class
```

### Using Singularity 

```
(CPU) singularity run -f -c -w reaction_class_cpu.sif
(GPU) singularity run -f -c -w --nv reaction_class_gpu.sif
```

## Step 3: Query the Service

- Sample query for reaction classification
```
curl http://0.0.0.0:9621/reaction_class \
	--header "Content-Type: application/json" \
	--request POST \
	--data '{"smiles": ["CC(O)CCCCC(O)CC>>CC(=O)CCCCC(=O)CC"]}'
```
- Sample response

```
{   
    "status":"SUCCESS",
    "error":"",
    "results":[{"rank":1,"reaction_num":"8.1.5","reaction_name":"Alcohol to ketone oxidation","reaction_classnum":"8.1","reaction_classname":"Oxidations to carbonyls","reaction_superclassnum":"8","reaction_superclassname":"Oxidations","prediction_certainty":0.7076228857040405},
    {"rank":2,"reaction_num":"8.1.3","reaction_name":"Ketone Dess-Martin oxidation","reaction_classnum":"8.1","reaction_classname":"Oxidations to carbonyls","reaction_superclassnum":"8","reaction_superclassname":"Oxidations","prediction_certainty":0.08394622802734375},
    {"rank":3,"reaction_num":"8.1.10","reaction_name":"Ketone Collins oxidation","reaction_classnum":"8.1","reaction_classname":"Oxidations to carbonyls","reaction_superclassnum":"8","reaction_superclassname":"Oxidations","prediction_certainty":0.0509367473423481},
    {"rank":4,"reaction_num":"8.1.7","reaction_name":"Ketone Jones oxidation","reaction_classnum":"8.1","reaction_classname":"Oxidations to carbonyls","reaction_superclassnum":"8","reaction_superclassname":"Oxidations","prediction_certainty":0.0179063118994236},
    {"rank":5,"reaction_num":"8.1.15","reaction_name":"Ketone Cornforth oxidation","reaction_classnum":"8.1","reaction_classname":"Oxidations to carbonyls","reaction_superclassnum":"8","reaction_superclassname":"Oxidations","prediction_certainty":0.013210642151534557},
    {"rank":6,"reaction_num":"8.1.26","reaction_name":"Ketone Ley-Griffith oxidation","reaction_classnum":"8.1","reaction_classname":"Oxidations to carbonyls","reaction_superclassnum":"8","reaction_superclassname":"Oxidations","prediction_certainty":0.009943865239620209},
    {"rank":7,"reaction_num":"8.1.13","reaction_name":"Ketone Sarett oxidation","reaction_classnum":"8.1","reaction_classname":"Oxidations to carbonyls","reaction_superclassnum":"8","reaction_superclassname":"Oxidations","prediction_certainty":0.006075253710150719},
    {"rank":8,"reaction_num":"8.1.4","reaction_name":"Alcohol to aldehyde oxidation","reaction_classnum":"8.1","reaction_classname":"Oxidations to carbonyls","reaction_superclassnum":"8","reaction_superclassname":"Oxidations","prediction_certainty":0.004777196794748306},
    {"rank":9,"reaction_num":"8.1.24","reaction_name":"Ketone Swern oxidation","reaction_classnum":"8.1","reaction_classname":"Oxidations to carbonyls","reaction_superclassnum":"8","reaction_superclassname":"Oxidations","prediction_certainty":0.003779704449698329},
    {"rank":10,"reaction_num":"8.3.1","reaction_name":"Alcohol to acid oxidation","reaction_classnum":"8.3","reaction_classname":"Alcohol to acid oxidation","reaction_superclassnum":"8","reaction_superclassname":"Oxidations","prediction_certainty":0.002700614742934704}]
 }
```

- Sample query for getting top classes for a batch of reactions
```
curl http://0.0.0.0:9621/get_top_class_batch \
	--header "Content-Type: application/json" \
	--request POST \
	--data '{"smiles": ["CC=CC>>CCCC", "ClCCC>>C=CC", "CC=CC>>CC(O)C(C)O"]}'
```
- Sample response
```
{
    "status":"SUCCESS",
    "error":"",
    "results":[
        ["7.6","Alkene to alkane"],
        ["9.7","Other functional group interconversion"],
        ["10.4","Other functional group addition"]
    ]
}
```
