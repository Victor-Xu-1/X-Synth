################################################################################
#
#   Makefile for askcos-vue-nginx
#
################################################################################

.PHONY: build build-ci push

VERSION ?= dev
GIT_HASH := $(shell git log -1 --format='format:%H')
GIT_DATE := $(shell git log -1 --format='format:%cs')
GIT_DESCRIBE := $(shell git describe --tags --always --dirty)

REGISTRY ?= registry.gitlab.com/mlpds_mit/askcos/askcos-vue-nginx
TAG ?= $(VERSION)
CORE_VERSION ?= $(VERSION)

main build:
	@echo Building docker image: $(REGISTRY):$(TAG)
	@docker build \
		-t $(REGISTRY):$(TAG) \
		--label "vue_nginx.version=$(VERSION)" \
		--label "vue_nginx.git.hash=$(GIT_HASH)" \
		--label "vue_nginx.git.date=$(GIT_DATE)" \
		--label "vue_nginx.git.describe=$(GIT_DESCRIBE)" \
		-f Dockerfile .

build-ci:
	@echo Building docker image: $(REGISTRY):$(TAG)
	@docker build \
		--progress=plain \
		-t $(REGISTRY):$(TAG) \
		--cache-from $(REGISTRY):dev \
		--build-arg BUILDKIT_INLINE_CACHE=1 \
		--label "vue_nginx.version=$(VERSION)" \
		--label "vue_nginx.git.hash=$(GIT_HASH)" \
		--label "vue_nginx.git.date=$(GIT_DATE)" \
		--label "vue_nginx.git.describe=$(GIT_DESCRIBE)" \
		-f Dockerfile .

push: build-ci
	@docker push $(REGISTRY):$(TAG)
