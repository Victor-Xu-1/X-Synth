
# QM Descriptors Prediction

---
Serving module for QM descriptors prediction. Models are released under the same license as the source code (MIT license).

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
(CPU) docker build -f Dockerfile_qm_des_cpu -t ${ASKCOS_REGISTRY}/qm_descriptors:1.0-cpu .
(GPU) docker build -f Dockerfile_qm_des_gpu -t ${ASKCOS_REGISTRY}/qm_descriptors:1.0-gpu .
```

## Step 2: Start the Service

### Using Docker

```
(CPU) sh scripts/serve_cpu_in_docker.sh
(GPU) sh scripts/serve_gpu_in_docker.sh
```
Note that GPU-based container requires a CUDA-enabled GPU and the <a href="https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html">NVIDIA Container Toolkit</a> (or nvidia-docker in the past). By default, the first GPU will be used.

Note that these scripts start the service in the background (i.e., in detached mode). So they would need to be explicitly stopped if no longer in use
```
docker stop qm_descriptors
```

## Step 3: Query the Service

- Sample query
```
curl http://0.0.0.0:9711/qm_descriptors \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"smiles": ["Cc1ccccc1"]}'
```
- Sample response
```
{
    "status": SUCCESS,
    "error": "",
    "results": {
      "smiles": str,
      "npa charge (e)": List[float],
      "npa charge + (e)": List[float],
      "npa charge - (e)": List[float],
      "npa parr function + (e)": List[float],
      "npa parr function - (e)": List[float],
      "shielding constant (ppm)": List[float],
      "1s valence orbital occupancy (e)": List[float],
      "2s valence orbital occupancy (e)": List[float],
      "2p valence orbital occupancy (e)": List[float],
      "3s valence orbital occupancy (e)": List[float],
      "3p valence orbital occupancy (e)": List[float],
      "4s valence orbital occupancy (e)": List[float],
      "4p valence orbital occupancy (e)": List[float],
      "bond index (unitless)": List[float],
      "bond length (Å)": List[float],
      "bond charge (e)": List[float],
      "natural ionicity (unitless)": List[float],
      "dipole moment (debye)": float,
      "traceless quadrupole moment (debye⋅Å)": float,
      "HOMO-3/LUMO (hartree)": float,
      "HOMO-3/LUMO+1 (hartree)": float,
      "HOMO-3/LUMO+2 (hartree)": float,
      "HOMO-3/LUMO+3 (hartree)": float,
      "HOMO-2/LUMO (hartree)": float,
      "HOMO-2/LUMO+1 (hartree)": float,
      "HOMO-2/LUMO+2 (hartree)": float,
      "HOMO-2/LUMO+3 (hartree)": float,
      "HOMO-1/LUMO (hartree)": float,
      "HOMO-1/LUMO+1 (hartree)": float,
      "HOMO-1/LUMO+2 (hartree)": float,
      "HOMO-1/LUMO+3 (hartree)": float,
      "HOMO/LUMO (hartree)": float,
      "HOMO/LUMO+1 (hartree)": float,
      "HOMO/LUMO+2 (hartree)": float,
      "HOMO/LUMO+3 (hartree)": float,
      "IP (hartree)": float,
      "EA (hartree)": float,
    }
}
```

## Unit Test

Requirement: `requests` and `pytest` libraries (pip installable)

With the service started, run
```
pytest
```
