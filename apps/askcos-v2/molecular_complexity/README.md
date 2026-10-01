# molecular_complexity

---
Serving module for molecular complexity and synthetic accessibility metrics, originally developed by Shree Sowndarya Santhanalakkshmi Vejaykummar and Guilian Luchini in Prof. Robert S. Paton's group at Colorado State University and adapted from https://github.com/patonlab/molcomplex. Modifications have been done to the files where appropriate.


## Metrics implemented
- "balan": Balaban J Score (Chem. Phys. Lett. 1982, 89, 399-404) 
- "bertz": Bertz Complexity (CT) Score (JACS 1981, 103, 3241-3243) 
- "boettcher": Boettcher Score (J. Chem. Inf. Model. 2016, 56, 3, 462–470)
- "hallkieralpha": Kier's alpha-modified shape indices 
- "ipc": IPC: Bonchev & Trinajstic's information content of the coefficients of the characteristic polynomial of the adjacency matrix of a hydrogen-suppressed graph of a molecule (J. Chem. Phys. 1977, 67, 4517-4533)
- "proudfoot": Proudfoot's Cm index based on atom environments (Bioorganic Med. Chem. Lett. 2017, 27, 2014–2017)
- "sascore": Ertl SA_Score (J. Cheminform. 2009, 1, 8)
- "scscore": Coley SCScore (J. Chem. Inf. Model. 2018, 58, 2, 252)
- "spatial": Spatial Score (J. Med. Chem. 2023, 66, 18, 12739–12750) 
- "twc": Rücker's total walk count (twc) index (J. Chem. Inf. Comput. Sci. 1993, 33, 683-695)

*Note: SYBA Score (J. Cheminformatics 2020, 12, 35) is no longer provided.*

## Step 1: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/molecular_complexity:1.0-cpu .
```

## Step 2: Start the Service

### Using Docker

```
sh scripts/serve_cpu_in_docker.sh
```

Note that the script starts the service in the background (i.e., in detached mode). So they would need to be explicitly stopped if no longer in use

```
docker stop molecular_complexity
```


## Step 3: Query the Service

- Sample query 1
```
curl http://0.0.0.0:9751/molecular_complexity  \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"smiles": "O=C(O)c1ccccc1", "complexity_metrics": ["balan", "bertz"]}'
```

- Sample response 1
```
{
  "status": "SUCCESS",
  "error": "",
  "results": 
    {
        "smiles" : str,
        "balan": float,
        "bertz": float
    }        
}
```

- Sample query 2
```
curl http://0.0.0.0:9751/molecular_complexity_batch  \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"smiles_list": ["Brc1ccccc1", "O=C(O)c1ccccc1"], "complexity_metrics": ["balan", "bertz"]}'
```

- Sample response 2
```
{
  "status": "SUCCESS",
  "error": "",
  "results": List of 
    {
        "smiles" : str,
        "balan": float,
        "bertz": float
    }        
  
}
