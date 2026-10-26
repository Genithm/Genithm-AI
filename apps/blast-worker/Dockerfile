FROM python:3.15.0-slim-trixie@sha256:f5b92f2a669a4c347044f29367f31983280b648250ca94dea66f98c53bc87e58

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
COPY genithm_blast_worker ./genithm_blast_worker
RUN python -m pip install . \
    && python -m pip uninstall -y pip setuptools
USER genithm
ENTRYPOINT ["genithm-blast-worker"]
