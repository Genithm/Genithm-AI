FROM python:3.14.8-slim-trixie@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system genithm \
    && adduser --system --ingroup genithm --home /nonexistent --no-create-home genithm

COPY pyproject.toml ./
COPY genithm_sequence_worker ./genithm_sequence_worker

RUN python -m pip install . \
    && python -m pip uninstall -y pip setuptools

USER genithm

ENTRYPOINT ["genithm-sequence-worker"]
