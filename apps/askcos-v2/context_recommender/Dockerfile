FROM registry.gitlab.com/mlpds_mit/askcosv2/askcos2_core/retro/template_relevance:1.0-cpu

ARG MAMBA_DOCKERFILE_ACTIVATE=1

ENV PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN --mount=type=cache,target=/root/.cache/pip \
    for attempt in 1 2 3 4 5; do \
        pip install \
            --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
            --trusted-host pypi.tuna.tsinghua.edu.cn \
            --prefer-binary \
            --retries 10 \
            --timeout 240 \
            fastapi==0.95.1 \
            pillow==10.1.0 \
            protobuf==3.19.0 \
            pydantic==1.10.12 \
            rdchiral==1.1.0 \
            requests==2.31.0 \
            scikit-learn==1.0.2 \
            scipy==1.7.3 \
            tensorflow-cpu==2.7.4 \
            urllib3==1.26.16 \
            uvicorn==0.21.1 \
            zipp==3.20.2 && exit 0; \
        sleep $((attempt * 30)); \
    done; \
    exit 1

COPY . /app/context_recommender
WORKDIR /app/context_recommender

EXPOSE 9901

ENV CUDA_VISIBLE_DEVICES=10

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9901"]
