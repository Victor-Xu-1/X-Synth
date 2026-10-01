# Cluster (reaction)

---
Serving module for reaction clusterer

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/cluster:1.0-cpu .
```

### Using Singularity

- Only option: build from local
```
singularity build -f cluster_cpu.sif singularity_cpu.def
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
(Docker)        docker stop cluster
(Singularity)   singularity instance stop cluster
```

## Step 3: Query the Service
Note that the clustering service depends on the API gateway in askcos2_core (more specifically, on the reaction classification service). Therefore, the query with "cluster_method" set to "rxn_class" would only work if the API gateway (with the backend services) has been started.

Sample Query
```
curl http://0.0.0.0:9801/cluster \
	--header "Content-Type: application/json" \
	--request POST \
	--data '{"original": "CC(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1", "outcomes": ["CC(=O)c1ccc2[nH]ccc2c1.CC(C)(C)OC(=O)OC(=O)OC(C)(C)C", "CC(=O)Cl.CC(C)(C)OC(=O)n1ccc2ccccc21", "CON(C)C(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1.C[Mg+]", "CC(C)(C)OC(=O)n1ccc2cc(Br)ccc21.CON(C)C(C)=O", "CC(O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1", "CC(O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1", "CC(=O)OC(C)=O.CC(C)(C)OC(=O)n1ccc2ccccc21", "CC(=O)Cl.CC(C)(C)OC(=O)n1ccc2cc(Br)ccc21"], "cluster_method": "hdbscan"}'

```
Sample response
```
{
    "status":"SUCCESS",
    "error":"",
    "results":[
        [0,1,2,3,4,5,6,7],
        {
            "0":"Reaction Cluster #1",
            "1":"Reaction Cluster #2",
            "2":"Reaction Cluster #3",
            "3":"Reaction Cluster #4",
            "4":"Reaction Cluster #5",
            "5":"Reaction Cluster #6",
            "6":"Reaction Cluster #7",
            "7":"Reaction Cluster #8"
        }
    ]
}
```

Sample Query
```
curl http://0.0.0.0:9801/cluster \
	--header "Content-Type: application/json" \
	--request POST \
	--data '{"original": "CC(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1", "outcomes": ["CC(=O)c1ccc2[nH]ccc2c1.CC(C)(C)OC(=O)OC(=O)OC(C)(C)C", "CC(=O)Cl.CC(C)(C)OC(=O)n1ccc2ccccc21", "CON(C)C(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1.C[Mg+]", "CC(C)(C)OC(=O)n1ccc2cc(Br)ccc21.CON(C)C(C)=O", "CC(O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1", "CC(O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1", "CC(=O)OC(C)=O.CC(C)(C)OC(=O)n1ccc2ccccc21", "CC(=O)Cl.CC(C)(C)OC(=O)n1ccc2cc(Br)ccc21"], "cluster_method": "kmeans"}'

```
Sample response
```
{
    "status":"SUCCESS",
    "error":"",
    "results": [
        [2,3,0,1,0,0,3,1],
        {
            "2":"Reaction Cluster #3",
            "3":"Reaction Cluster #4",
            "0":"Reaction Cluster #1",
            "1":"Reaction Cluster #2"
        }
    ]
}
```


Sample Query
```
curl http://0.0.0.0:9801/cluster \
	--header "Content-Type: application/json" \
	--request POST \
	--data '{"original": "CC(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1", "outcomes": ["CC(=O)c1ccc2[nH]ccc2c1.CC(C)(C)OC(=O)OC(=O)OC(C)(C)C", "CC(=O)Cl.CC(C)(C)OC(=O)n1ccc2ccccc21", "CON(C)C(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1.C[Mg+]", "CC(C)(C)OC(=O)n1ccc2cc(Br)ccc21.CON(C)C(C)=O", "CC(O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1", "CC(O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1", "CC(=O)OC(C)=O.CC(C)(C)OC(=O)n1ccc2ccccc21", "CC(=O)Cl.CC(C)(C)OC(=O)n1ccc2cc(Br)ccc21"], "cluster_method": "rxn_class"}'

```
Sample response
```
{
    "status":"SUCCESS",
    "error":"",
    "results": [
        [3,1,0,0,4,4,1,2],
        {
            "3":"5.1: NH protections",
            "1":"3.10: Aromatic C-C bond formation",
            "0":"3.9: Other Organometallic C-C bond formation",
            "4":"8.1: Oxidations to carbonyls",
            "2":"3.11: Other C-C bond formation"
        }
    ]
}
```
