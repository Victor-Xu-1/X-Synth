# RetroSim

Benchmarking and serving modules for similarity-based one-step retrosynthesis with RetroSim, based on the manuscript (https://pubs.acs.org/doi/full/10.1021/acscentsci.7b00355).

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
docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/retro/retrosim:1.0-cpu .
```

### Step 2: Start the Service

#### Using Docker

```
sh scripts/serve_cpu_in_docker.sh
```

Note that these scripts start the service in the background (i.e., in detached mode). So they would need to be explicitly stopped if no longer in use
```
(Docker)        docker stop retro_retrosim
```

### Step 3: Query the Service
Note that the `retro_retrosim` service depends on the API gateway in askcos2_core, as it needs to access the reaction collection(s) via the gateway. Therefore, the query would only work if the API gateway has been started.

- Sample query
```
curl http://0.0.0.0:9441/predictions \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"smiles": ["[O:1]=[CH:2]/[CH:3]=[CH:4]/[C:5]1=[CH:8][CH:9]=[C:10]([C:12](=[O:13])[OH:14])[O:11][CH:6]1[OH:7]"], "threshold": 0.3, "top_k": 10, "reaction_set": "bkms" }'
```
- Sample response
```
List of
{
    "products": List[str],
    "scores": List[float],
    "reaction_ids": List[str],
    "reaction_sets": List[str]
},
```

### Unit Test for Serving (Optional)

Requirement: `requests` and `pytest` libraries (pip installable)

With the service started, run
```
pytest
```

## Integration with new reaction sets
RetroSim is generally different from other one-step models in terms of dependency and code organization. It does not have a training component, and is *not* standalone since it needs to access the reaction collection(s), something we designed to be populated during database seeding and only readable via the API gateway. Therefore, adding a new reaction set requires us to go back to the askcos2_core and append to the database

```shell
$ cd askcos2_core
$ bash deploy.sh seed-db --reactions /path/to/my.new.reactions.json.gz
```

Here `my.new.reactions.json.gz` is a gzip-compressed json file containing a **single** list of reaction entries, each with a unique `_id`, a unique `reaction_id`, a `template_set`, a `reaction_smiles`, **and** `reaction_smarts`, plus other arbitrary fields. For example

```json
[
  {"_id": "new_1", "reaction_id": 1, "template_set": "secret", "reaction_smiles": "[CH4:2].[CH4:1]>>[CH3:1][CH3:2]"},
  {"_id": "new_2", "reaction_id": 2, "template_set": "secret", "reaction_smiles": "[CH4:3].[CH3:1][CH3:2]>>[CH3:1][CH2:2][CH3:3]"},
  {"_id": "new_3", "reaction_id": 3, "template_set": "secret", "reaction_smiles": "[CH4:1].[CH3:2][CH2:3][CH3:4]>>[CH3:1][CH2:2][CH2:3][CH3:4]"},
  ...
]
```

We decide to require `reaction_smarts`, or essentially the template associated with a given reaction SMILES, to be precomputed and supplied. Doing it otherwise (e.g., during deployment) may slow down or even hang the process, possibly with unpredictable behaviors which can bring down the whole ASKCOS app all together. Meanwhile, the process of extracting templates from reactions is very flexible in general and more appropriate to be done by the user. For the bkms and USPTO_FULL reaction data we provide, `reaction_smarts` have been computed using the original implementation (please see [convert_bkms.py](https://gitlab.com/mlpds_mit/askcosv2/askcos2_core/-/blob/main/scripts/convert_bkms.py?ref_type=heads) and [convert_USPTO_FULL.py](https://gitlab.com/mlpds_mit/askcosv2/askcos2_core/-/blob/main/scripts/convert_USPTO_FULL.py?ref_type=heads)). These are more general than typical templates extracted with RDChiral, which is important for RetroSim to propose a sufficient number of suggestions.

Once the new reaction set has been seeded into the mongo database, they can now be specified in the query after restarting ASKCOS. E.g.,

```shell
$ cd askcos2_core
$ make restart
$ curl http://0.0.0.0:9441/predictions \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"smiles": ["[O:1]=[CH:2]/[CH:3]=[CH:4]/[C:5]1=[CH:8][CH:9]=[C:10]([C:12](=[O:13])[OH:14])[O:11][CH:6]1[OH:7]"], "threshold": 0.3, "top_k": 10, "reaction_set": "secret" }'
```
