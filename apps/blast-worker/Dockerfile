FROM python:3.14.6-slim-trixie@sha256:7bec7ddcddeff7975d6ba9b4be7dd6f6b2f55e7491539145e2978f7f97ce9144

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
