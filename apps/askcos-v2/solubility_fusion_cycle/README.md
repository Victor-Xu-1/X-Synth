# Fusion Cycle

Serving modules for Fusion Cycle, a data-driven model for predicting solubility via a thermodynamic cycle and solvent ensembles. Adapted from the [official repo](https://github.com/emadalibrahim/Fusion-Cycle). Unless otherwise specified, models are released under the same license as the source code (MIT license).

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
docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/solubility_fusion_cycle:1.0-cpu .
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
docker stop solubility_fusion_cycle
```

### Step 4/4: Query the Service

- Sample query

```bash
curl http://0.0.0.0:9771/Fusion_Cycle \
 --header "Content-Type: application/json" \
 --request POST \
 --data '{"solute_smiles": ["Cc1ccccc1", "Cc1ccccc1"], "solvent_smiles": ["CO", "CO"], "temperature": [298.15, 298.15], "density": [12.5, 12.5]}'
```

- Sample response

```
{
    "status": "SUCCESS",
    "error": "",
    "results": [
        {
            "solute_smiles_canonical": "Cc1ccccc1",
            "solvent_smiles_canonical": "CO",
            "Temperature [K]": 298.15,
            "solvent_density": 12.5,
            "SMILES": "CO",
            "MP_pred": 196.4280548095703,
            "MP_std": 2.9136085510253906,
            "logS_calc": 0.31267134213488423,
            "gamma": 5.0430216789245605
        },
        {
            "solute_smiles_canonical": "Cc1ccccc1",
            "solvent_smiles_canonical": "CO",
            "Temperature [K]": 298.15,
            "solvent_density": 12.5,
            "SMILES": "CO",
            "MP_pred": 196.4280548095703,
            "MP_std": 2.9136085510253906,
            "logS_calc": 0.31267134213488423,
            "gamma": 5.0430216789245605
        }
    ]
}
```

### Unit Test for Serving (Optional)

Requirement: `requests` and `pytest` libraries (pip installable)

With the service started, run

```bash
pytest
```
