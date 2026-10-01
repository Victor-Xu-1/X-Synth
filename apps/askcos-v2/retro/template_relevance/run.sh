export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
docker build -f Dockerfile_gpu -t ${ASKCOS_REGISTRY}/retro/template_relevance:1.0-gpu .
sh scripts/benchmark_in_docker.sh
