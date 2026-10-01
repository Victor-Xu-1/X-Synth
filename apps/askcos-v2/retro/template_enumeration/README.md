# TemplateEnumeration

Serving modules for one-step retrosynthesis by template enumeration.

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
docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/retro/template_enumeration:1.0-cpu .
```

### Step 2: Start the Service

#### Using Docker

```
sh scripts/serve_cpu_in_docker.sh
```

Note that these scripts start the service in the background (i.e., in detached mode). So they would need to be explicitly stopped if no longer in use
```
(Docker)        docker stop retro_template_enumeration
```

### Step 3: Query the Service

- Sample query (also in Swagger doc at 0.0.0.0:9461/docs if opened in the browser)
```
curl http://0.0.0.0:9461/predictions \
    --header "Content-Type: application/json" \
    --request POST \
    --data '{"smiles": ["CN(C)CCOC(c1ccccc1)c1ccccc1"],
    "model_name": "USPTO_50k" }'
```
- Sample response
```
List of
{
    "reactants": List[str],
    "templates": List[dict],
    "scores": List[float]       # which have all been hardcoded to 0.0
}
```

## Adding new template sets
Prepare your custom templates json file as a single `List` of `Dict`s, each of which contains at least two required field called `reaction_smarts`, and `template_set`, along with other metadata if you want. Ensure that the file ends with `.json` and put it under the `data/` folder (where the default `retro.templates.*.json` are located). For example

```json
[
  {"_id": "new_1", "template_set": "secret", "reaction_smarts": "[c:1]-[N&H2&+0&D1:2]>>[c:1]-[N&H0&+&D3:2](=O)-[O&-]"},
  {"_id": "new_2", "template_set": "secret", "reaction_smarts": "[c:1]-[O&H1&+0&D1:2]>>[c:1]-[O&H0&+0&D2:2]-C"},
  ...
]
```

Rebuild the docker image to include the new template data. Then restart the service and the new template set should now be usable, i.e.,

```shell
$ docker stop retro_template_enumeration
$ docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/retro/template_enumeration:1.0-cpu .
$ sh scripts/serve_cpu_in_docker.sh
```

In general, please keep the number of templates to be under 2,000. Or the template enumeration/application process can take a long time (more than a few seconds).
