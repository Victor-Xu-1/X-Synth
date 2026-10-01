# Solubility

---
Serving module for solubility. The code was extracted from the legacy solubility image. Models are released under the same license as the source code (MIT license).

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/solubility:1.0-cpu .
```

## Step 2: Start the Service

### Using Docker

```
sh scripts/serve_cpu_in_docker.sh
```

The error messages related to torchserve logging can be safely ignored. Note that the script starts the service in the background (i.e., in detached mode). So they would need to be explicitly stopped if no longer in use

```
docker stop solubility
```

## Step 3: Query the Service

- Sample query 1 (without threshold)
```
curl http://0.0.0.0:9732/predictions/solprop \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"solvent_list": ["O"], "solute_list": ["CCO"], "temp_list": [298], "ref_solvent_list": [null], "ref_solubility_list": [null], "ref_temp_list": [null], "hsub298_list": [null], "cp_gas_298_list": [null], "cp_solid_298_list": [null]}'

```

- Sample response 1
```
{
  "Solvent": [
    "O"
  ],
  "Solute": [
    "CCO"
  ],
  "Temp": [
    298
  ],
  "Ref. Solv": [
    null
  ],
  "Ref. Solub": [
    null
  ],
  "Ref. Temp": [
    null
  ],
  "Input Hsub298": [
    null
  ],
  "Input Cpg298": [
    null
  ],
  "Input Cps298": [
    null
  ],
  "Error Message": [
    null
  ],
  "Warning Message": [
    null
  ],
  "logST (method1) [log10(mol/L)]": [
    "1.38"
  ],
  "logST (method2) [log10(mol/L)]": [
    "1.38"
  ],
  "dGsolvT [kcal/mol]": [
    "-5.01"
  ],
  "dHsolvT [kcal/mol]": [
    "-10.6"
  ],
  "dSsolvT [cal/K/mol]": [
    "-0.0186"
  ],
  "Pred. Hsub298 [kcal/mol]": [
    "11.8"
  ],
  "Pred. Cpg298 [cal/K/mol]": [
    "15.1"
  ],
  "Pred. Cps298 [cal/K/mol]": [
    "21.7"
  ],
  "logS298 [log10(mol/L)]": [
    "1.38"
  ],
  "uncertainty logS298 [log10(mol/L)]": [
    "0.199"
  ],
  "dGsolv298 [kcal/mol]": [
    "-5.01"
  ],
  "uncertainty dGsolv298 [kcal/mol]": [
    "0.0125"
  ],
  "dHsolv298 [kcal/mol]": [
    "-10.5"
  ],
  "uncertainty dHsolv298 [kcal/mol]": [
    "0.48"
  ],
  "E": [
    "0.2428"
  ],
  "S": [
    "0.4318"
  ],
  "A": [
    "0.3693"
  ],
  "B": [
    "0.4798"
  ],
  "L": [
    "1.463"
  ],
  "V": [
    "0.4491"
  ]
```

## Unit Test (Optional)

Requirement: `requests` and `pytest` libraries (pip installable)

With the service started, run
```
pytest
```
