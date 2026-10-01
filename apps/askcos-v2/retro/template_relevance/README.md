# Template Relevance Model for One-step Retrosynthesis

Training, benchmarking and serving modules for one-step retrosynthesis with the template-relevance model, which is a variant of NeuralSym (https://chemistry-europe.onlinelibrary.wiley.com/doi/abs/10.1002/chem.201605499), a template prioritizer/classifier using a feedforward (and optionally, highway) neural network. 

Unless otherwise specified, models are released under the same license as the source code (MIT license). The reaxys model is released under the **non-commercial** CC BY-NC 4.0 license. It is licensed under the Machine Learning for Pharmaceutical Discovery and Synthesis (MLPDS) Consortium, and as licensors, companies and entities under MLPDS enjoy unrestricted use of the reaxys model.

## Serving

### Step 1/4: Environment Setup

First set up the url to the remote registry
```
export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
```
Then follow the instructions below to use either Docker, or Singularity (if Docker or root privilege is not available). For deployment/serving, building either the CPU or the GPU image would suffice. If GPUs are not available, just go with the CPU image. For retraining/benchmarking, building the GPU image is required.

**Note**: only Docker is fully supported. The support for Singularity is partial, and if you run the Docker image with other engines (e.g., Apptainer, Podman), you would need to craft your own `benchmark*.sh` script for the pipeline to work. For Docker, it is recommended to add the user to the `docker` group first, so that only `docker run` or `sh scripts_with_docker_command.sh` is needed, rather than `sudo docker run` or `sudo sh scripts_with_docker_command.sh`. We have seen a lot of troubles with the scripts if executed with `sudo`.

#### Using Docker

- Option 1 (recommended): build from local
```
(CPU) docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/retro/template_relevance:1.0-cpu .
(GPU) docker build -f Dockerfile_gpu -t ${ASKCOS_REGISTRY}/retro/template_relevance:1.0-gpu .
```

- Option 2 (only for GPU; possibly not up-to-date): pull from gitlab registry

```
(GPU) docker pull ${ASKCOS_REGISTRY}/retro/template_relevance:1.0-gpu
```

#### Using Singularity

- Only option: build from local
```
(CPU) singularity build -f template_relevance_cpu.sif singularity_cpu.def
(GPU) singularity build -f template_relevance_gpu.sif singularity_gpu.def
```

### Step 2/4: Download Trained Models

```
sh scripts/download_trained_models.sh
```

### Step 3/4: Start the Service

#### Using Docker

```
(CPU) sh scripts/serve_cpu_in_docker.sh
(GPU) sh scripts/serve_gpu_in_docker.sh
```
GPU-based container requires a CUDA-enabled GPU and the <a href="https://www.example.com/my great page">NVIDIA Container Toolkit</a> (or nvidia-docker in the past). By default, the first GPU will be used.

#### Using Singularity

```
(CPU) sh scripts/serve_cpu_in_singularity.sh
(GPU) sh scripts/serve_gpu_in_singularity.sh
```
The error messages related to torchserve logging can be safely ignored. Note that these scripts start the service in the background (i.e., in detached mode). So they would need to be explicitly stopped if no longer in use
```
(Docker)        docker stop retro_template_relevance
(Singularity)   singularity instance stop retro_template_relevance
```

### Step 4/4: Query the Service

- Sample query
```
curl http://0.0.0.0:9410/predictions/reaxys \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"smiles": ["[Br:1][CH2:2]/[CH:3]=[CH:4]/[C:5](=[O:6])[O:7][Si:8]([CH3:9])([CH3:10])[CH3:11]", "CC(C)(C)OC(=O)N1CCC(OCCO)CC1"]}'
```
We currently provide 6 models, namely, `reaxys`, `reaxys_biocatalysis`, `cas`, `pistachio`, `pistachio_ringbreaker` and `bkms_metabolic`. The request format is the same; simply replace the last part of the URL with the desired model name. For instance, the endpoint for the `pistachio_ringbreaker` model is
`http://0.0.0.0:9410/predictions/pistachio_ringbreaker`.

- Sample response
```
List of
{
    "templates": List[Dict[str, Any]], list of top k templates with metadata,
    "reactants": List[str], list of top k proposed reactants based on the templates,
    "scores": List[float], list of top k corresponding scores
},
```

### Unit Test for Serving (Optional)

Requirement: `requests` and `pytest` libraries (pip installable)

With the service started, run
```
pytest
```

## Retraining and benchmarking (GPU Required)

### Step 1/4: Environment Setup

Follow the instructions in Step 1/4 in the Serving section to build the GPU docker image. It should have the name `${ASKCOS_REGISTRY}/retro/template_relevance:1.0-gpu`

Note: the Docker needs to be rebuilt before running whenever there is any change in code.

### Step 2/4: Data Preparation

Note that the preprocessing stage requires all reaction SMILES to be atom mapped. Various atom mapping tools are included in ASKCOSv2 in case you need them, which can be found at https://gitlab.com/mlpds_mit/askcosv2/atom_map. We found RXNMapper to be more robust in general.

- Option 1: provide pre-split reaction data

Prepare the raw .csv files for train, validation and test. The required columns are "id" and "rxn_smiles", where "rxn_smiles" contains reaction SMILES with atom mapping. This is the typical setting, where the pre-split files are supplied (e.g., using existing benchmarking datasets or user-preprocessed data).

You can also include other columns in the .csv files, which will all be saved during preprocessing (in `reactions.$DATA_NAME.json.gz`). The processed files can then be seeded into the database for querying. In particular, values can be provided for the `reference_url` field (e.g., "https://patents.google.com/patent/US20030133927A1/") and optionally, the `reference` field (e.g., "US20030133927A1"). If seeded later, the links for the precedent reactions of suggested templates would be populated in the user interface (in the template info view).

- Option 2: provide unsplit reaction data

It is also possible to supply a single .csv file containing all reactions and let the preprocessing engine handle the splitting. In this case, by default, reactions with failed template extraction or rare templates will be filtered out, after which the remaining reactions will be deduplicated, split into train/val/test splits, and used to populate the respective .csv files.

### Step 3/4: Path Configuration

- Case 1: if pre-split reaction data is provided

Configure the environment variables in `./scripts/benchmark_in_docker_presplit.sh`, especially the paths, to point to the *absolute* paths of raw files and desired output paths.
```
# benchmark_in_docker_presplit.sh
...
export DATA_NAME="my_new_reactions"
export TRAIN_FILE=$PWD/new_data/raw_train.csv
export VAL_FILE=$PWD/new_data/raw_val.csv
export TEST_FILE=$PWD/new_data/raw_test.csv
...
```

- Case 2: if unsplit reaction data is provided

Configure the environment variables in `./scripts/benchmark_in_docker_unsplit.sh`, especially the paths, to point to the *absolute* paths of the raw file and desired output paths.
```
# benchmark_in_docker_unsplit.sh
...
export DATA_NAME="my_new_reactions"
export ALL_REACTION_FILE=$PWD/new_data/all_reactions.csv
...
```
the default train/val/test ratio is 98:1:1, which can be adjusted too. For example, if you want to use most of the data for training and very little for validation or testing,
```
# benchmark_in_docker_unsplit.sh
...
bash scripts/preprocess_in_docker.sh --split_ratio 99:1:0
bash scripts/train_in_docker.sh
bash scripts/predict_in_docker.sh
```

### Step 4/4: Training and Benchmarking

Run benchmarking on a machine with GPU using

```
sh scripts/benchmark_in_docker_presplit.sh
```

for pre-split data, or

```
sh scripts/benchmark_in_docker_unsplit.sh
```

for unsplit data. This will run the preprocessing, training and predicting for the template relevance model with top-n accuracies up to n=50 as the final outputs. Progress and result logs will be saved under `./logs`.

The estimated running times for benchmarking the USPTO_50k dataset on a 32-core machine with 1 RTX3090 GPU are

* Preprocessing: ~10 mins
* Training: ~10 mins
* Testing: ~5 mins

The training parameters typically do not need to be adjusted, especially on larger datasets with more than 10,000 templates. We leave it up to the user to adjust the training parameters in `scripts/train_in_docker.sh`, if you know what you are doing.

## Converting Trained Model into Servable Archive (Optional)

If you want to create servable model archives from own checkpoints (e.g., trained on different datasets),
please refer to the archiving scripts (`scripts/archive_in_docker.sh`).
Change the arguments accordingly in the script before running.
It's mostly bookkeeping by replacing the data name and/or checkpoint paths; the script should be self-explanatory. Then execute the scripts with
```
sh scripts/archive_in_docker.sh
```
The servable model archive (.mar) will be generated under `./mars`. Serving newly archived models is straightforward; simply replace the `--models` args in `scripts/serve_{cpu,gpu}_in_{docker,singularity}.sh`

with the new model name and the .mar archive. The `--models` flag for torchserve can also take multiple arguments to serve multiple model archives concurrently.

To integrate your new model with ASKCOS frontend, please refer to the [ASKCOS wiki](https://gitlab.com/mlpds_mit/askcosv2/askcos2_deploy/-/wikis/Model-retraining-and-integration) for the detailed instruction. Note that the integration also requires {reactions,historian,retro.templates}.$DATA_NAME.json.gz under the processed data path, which should have been generated as part of the preprocessing pipeline.
