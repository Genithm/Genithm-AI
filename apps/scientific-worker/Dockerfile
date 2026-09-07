FROM python:3.13.15-slim-trixie@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
RUN addgroup --system genithm && adduser --system --ingroup genithm --home /nonexistent --no-create-home genithm \
    && apt-get update \
    && apt-get install --no-install-recommends -y mafft=7.505-1 \
    && test "$(dpkg-query -W -f='${Version}' mafft)" = "7.505-1" \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
COPY genithm_scientific_worker ./genithm_scientific_worker
RUN python -m pip install . \
    && python -m pip uninstall -y pip setuptools
USER genithm
ENTRYPOINT ["genithm-scientific-worker"]
