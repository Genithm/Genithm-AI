FROM python:3.13.15-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
RUN addgroup --system genithm && adduser --system --ingroup genithm --home /nonexistent --no-create-home genithm
COPY pyproject.toml ./
COPY genithm_source_worker ./genithm_source_worker
RUN python -m pip install .
USER genithm
ENTRYPOINT ["genithm-source-worker"]
