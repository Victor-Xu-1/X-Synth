export ASKCOS_REGISTRY=registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core
docker stop molecular_complexity
docker rm molecular_complexity
docker build -f Dockerfile_cpu -t ${ASKCOS_REGISTRY}/molecular_complexity:1.0-cpu .
sh scripts/serve_cpu_in_docker.sh