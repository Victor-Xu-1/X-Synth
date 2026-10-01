# Context Recommendation Service
A standalone context recommendation module for ASKCOS. Models are released under the same license as the source code (MIT license).

## Step 1/4: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```

### Using Docker

- Only option: build from local
```
docker build -f Dockerfile -t ${ASKCOS_REGISTRY}/context_recommender:1.0-cpu .
```

### Using Singularity 

- Only option: build from local
```
singularity build -f context_cpu.sif singularity_cpu.def
```

## Step 2/4: Download Trained Models

```
sh scripts/download_trained_models.sh
```

## Step 3/4: Start the Service

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
(Docker)        docker stop context_recommender
(Singularity)   singularity instance stop context_recommender
```

## Step 4/4: Query the Service

1. To check if the service is running:
```
$ curl -X GET 0.0.0.0:9901/health
{"message":"Alive!"}
```

2. v1 model
- To check the uncleaned output from the v1 model

``` 
curl http://0.0.0.0:9901/api/v1/condition_uncleaned \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"smiles": "CC(=O)O.Fc1ccccc1Nc1cccc2ccccc12>>Cc1c2cccc(F)c2nc2c1ccc1ccccc12",
                "reagents": ["CC(=O)O"],
                "n_conditions": 10}'
```
    
Sample output
    
``` 
[["","","","O.O.O.CCN1C=C(C(O)=O)C(=O)c2cnc(nc12)N3CCNCC3","",149.5915985107422,null,false],["","","","O=S(=O)(O)O","",124.50691986083984,null,false],["CC(=O)[O-].[Pd+2]","","","O=P12OP3(=O)OP(=O)(O1)OP(=O)(O2)O3","",121.85145568847656,null,false],["","","","O=P(O)(O)O","",152.16854858398438,null,false],["CC(=O)[O-].[Pd+2]","","","O=S(=O)(O)C(F)(F)F","",109.4285659790039,null,false],["CC(=O)[O-].[Pd+2]","","","","",137.16810607910156,null,false],["CC(=O)[O-].[Pd+2]","O","","O=S(=O)([O-])C1=CC(P(C2=CC=CC=C2)C2=CC=CC=C2)=CC=C1.[Na+]","",137.23150634765625,1,true],["CC(=O)[O-].[Pd+2]","O","","N.O=S(=O)(O)OOS(=O)(=O)O","",119.04814910888672,1,true],["","O","","O=S(=O)(O)O","",125.0728988647461,1,true],["CC(=O)[O-].[Pd+2]","O","","O=S(=O)([O-])OOS(=O)(=O)[O-].[K+]","",118.73213958740234,1,true]]
```

- To check the cleaned output from the v1 model

``` 
curl http://0.0.0.0:9901/api/v1/condition_cleaned \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"smiles": "CC(=O)O.Fc1ccccc1Nc1cccc2ccccc12>>Cc1c2cccc(F)c2nc2c1ccc1ccccc12",
                "reagents": ["CC(=O)O"],
                "n_conditions": 10}'
```
    
Sample output

``` 
[[149.5915985107422,"","O.O.O.CCN1C=C(C(O)=O)C(=O)c2cnc(nc12)N3CCNCC3",""],[124.50691986083984,"","O=S(=O)(O)O",""],[121.85145568847656,"","O=P12OP3(=O)OP(=O)(O1)OP(=O)(O2)O3","CC(=O)[O-].[Pd+2]"],[152.16854858398438,"","O=P(O)(O)O",""],[109.4285659790039,"","O=S(=O)(O)C(F)(F)F","CC(=O)[O-].[Pd+2]"],[137.16810607910156,"","","CC(=O)[O-].[Pd+2]"],[137.23150634765625,"O","O=S(=O)([O-])C1=CC(P(C2=CC=CC=C2)C2=CC=CC=C2)=CC=C1.[Na+]","CC(=O)[O-].[Pd+2]"],[119.04814910888672,"O","N.O=S(=O)(O)OOS(=O)(=O)O","CC(=O)[O-].[Pd+2]"],[125.0728988647461,"O","O=S(=O)(O)O",""],[118.73213958740234,"O","O=S(=O)([O-])OOS(=O)(=O)[O-].[K+]","CC(=O)[O-].[Pd+2]"]]
```

3. v2 model
- To check the output from v2 model:

With GRAPH model
```
$ curl http://0.0.0.0:9901/api/v2/condition/GRAPH \
   --header "Content-Type: application/json" \
   --request POST \
   --data '{"smiles": "CC(=O)O.Fc1ccccc1Nc1cccc2ccccc12>>Cc1c2cccc(F)c2nc2c1ccc1ccccc12",
            "reagents": ["CC(=O)O"],
            "n_conditions": 10}'
```

Output:

```
List[{"agents": List[{"smi_or_name": str,
                       "role": str"}],
      "temperature": float,
      "score": float
      }]
```

With FP model
```
$ curl http://0.0.0.0:9901/api/v2/condition/FP \
	--header "Content-Type: application/json" \
	--request POST \
	--data '{"smiles": "CC(=O)O.Fc1ccccc1Nc1cccc2ccccc12>>Cc1c2cccc(F)c2nc2c1ccc1ccccc12",
			 "reagents": ["CC(=O)O"],
			 "n_conditions": 10}'
```

Output

```
List[{"agents": List[{"smi_or_name": str,
                        "role": str"}],
      "temperature": float,
      "score": float
      }] 
```

- To check the raw output from the v2 model (using /predict/{model} endpoint)
    
``` 
curl http://0.0.0.0:9901/api/v2/predict/FP \
     --header "Content-Type: application/json" \
     --request POST \
     --data '{"smiles": "CC(=O)O.Fc1ccccc1Nc1cccc2ccccc12>>Cc1c2cccc(F)c2nc2c1ccc1ccccc12",
              "n_conditions": 10}'
```
    
Sample output

``` 
[{"reagents_score":0.16961775720119476,"temperature":326.28561179637904,"reagents":{},"reactants":{"CC(=O)O":1.3868687152862549,"Fc1ccccc1Nc1cccc2ccccc12":1.0}},{"reagents_score":0.06638692539174507,"temperature":318.9070260822773,"reagents":{"O":342.3971862792969},"reactants":{"CC(=O)O":1.3615175485610962,"Fc1ccccc1Nc1cccc2ccccc12":1.0}},{"reagents_score":0.05614683018987643,"temperature":317.54818053245543,"reagents":{"Cl":6.7466607093811035},"reactants":{"CC(=O)O":1.4262408018112183,"Fc1ccccc1Nc1cccc2ccccc12":1.0}},{"reagents_score":0.04512215822813802,"temperature":348.95229263305663,"reagents":{"O":457.31610107421875,"O=P(O)(O)O":12.275940895080566},"reactants":{"CC(=O)O":1.3235125541687012,"Fc1ccccc1Nc1cccc2ccccc12":1.0}},{"reagents_score":0.03651721233459178,"temperature":314.98607075214386,"reagents":{"O":395.8489990234375,"Cl":5.860754489898682},"reactants":{"CC(=O)O":1.391208291053772,"Fc1ccccc1Nc1cccc2ccccc12":1.0}},{"reagents_score":0.021237979617355407,"temperature":354.6680338025093,"reagents":{"O=P(O)(O)O":12.968862533569336},"reactants":{"CC(=O)O":1.3495041131973267,"Fc1ccccc1Nc1cccc2ccccc12":1.0}},{"reagents_score":0.014528762092782976,"temperature":310.35855220556255,"reagents":{"CCOCC":26.68754768371582},"reactants":{"CC(=O)O":1.3982794284820557,"Fc1ccccc1Nc1cccc2ccccc12":1.0}},{"reagents_score":0.011404589593256853,"temperature":325.55693897008894,"reagents":{"C1COCCO1":33.59772872924805},"reactants":{"CC(=O)O":1.3942351341247559,"Fc1ccccc1Nc1cccc2ccccc12":1.0}},{"reagents_score":0.010095760186039361,"temperature":314.9552345216274,"reagents":{"Cl":6.7369384765625,"C1COCCO1":30.003385543823242},"reactants":{"CC(=O)O":1.4195342063903809,"Fc1ccccc1Nc1cccc2ccccc12":1.0}},{"reagents_score":0.00934896941933004,"temperature":321.17663125991817,"reagents":{"O":294.9776916503906,"N":2.506957530975342},"reactants":{"CC(=O)O":1.412508487701416,"Fc1ccccc1Nc1cccc2ccccc12":1.0}}]
```
