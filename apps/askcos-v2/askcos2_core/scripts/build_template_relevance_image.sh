#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE_TAG="${1:-registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core/retro/template_relevance:1.0-cpu}"
LOG_FILE="${2:-/tmp/askcos_build_logs/template_relevance_build.log}"

mkdir -p "$(dirname "$LOG_FILE")"
cd "$ROOT_DIR/retro/template_relevance"

echo "Building $IMAGE_TAG from $(pwd)" | tee "$LOG_FILE"
if [[ "${DOCKER_BUILDKIT:-1}" == "0" ]]; then
  docker build -t "$IMAGE_TAG" -f Dockerfile_cpu . 2>&1 | tee -a "$LOG_FILE"
else
  docker build --progress=plain -t "$IMAGE_TAG" -f Dockerfile_cpu . 2>&1 | tee -a "$LOG_FILE"
fi
