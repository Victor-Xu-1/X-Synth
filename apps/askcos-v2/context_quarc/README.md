# QUARC (QUAtitative Recommendations of reaction Conditions)

Serving modules for reaction condition recommendation with QUARC, a data-driven model for predicting agents, temperature, and equivalence ratios for organic synthesis. Adapted from [quarc-oss](https://github.com/Xiaoqi-Sun/quarc-oss). Unless otherwise specified, models are released under the same license as the source code (MIT license).

## Serving

### Step 1/4: Environment Setup

First set up the url to the remote registry

```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

Then follow the instructions below to use Docker. It is recommended to add the user to the `docker` group first, so that only `docker run` is needed.

#### Using Docker

- Only option: build from local

```bash
docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/context_quarc:1.0-cpu .
```

### Step 2/4: Download Trained Models

```bash
sh scripts/download_trained_models.sh
```

### Step 3/4: Start the Service

#### Using Docker

```bash
sh scripts/serve_cpu_in_docker.sh
```

Note that these scripts start the service in the background (i.e., in detached mode). So they would need to be explicitly stopped if no longer in use

```bash
docker stop context_quarc
```

### Step 4/4: Query the Service

- Sample query

```bash
curl http://0.0.0.0:9921/condition_prediction \
 --header "Content-Type: application/json" \
 --request POST \
 --data '{"smiles": ["CC(C)(C)OC(=O)O[C:1](=[O:2])[O:3][C:4]([CH3:5])([CH3:6])[CH3:7].[CH3:8][c:9]1[cH:10][c:11]([nH:12][cH:13]1)[CH:14]=[O:15]>CN(C)c1ccncc1.CC#N>[CH3:5][C:4]([CH3:6])([CH3:7])[O:3][C:1](=[O:2])[n:12]1[cH:13][c:9]([cH:10][c:11]1[CH:14]=[O:15])[CH3:8]"], "top_k": 3}'
```

- Sample response

```
[
  // one per reaction SMILES
  {
    "predictions": [
      {
        "rank": int,
        "agents": List[str],
        "temperature": str,
        "reactant_amounts": [
          {
            "reactant": str,
            "amount_range": str
          },
          ...
        ],
        "agent_amounts": [
          {
            "agent": str,
            "amount_range": str
          },
          ...
        ],
        "score": float
      },
     // ... up to top_k predictions per reaction SMILES
    ]
  },
  ...
]
```

### Unit Test for Serving (Optional)

Requirement: `requests` and `pytest` libraries (pip installable)

With the service started, run

```bash
pytest
```

## Retraining and benchmarking

Please refer to the [quarc-oss](https://github.com/Xiaoqi-Sun/quarc-oss) repo.