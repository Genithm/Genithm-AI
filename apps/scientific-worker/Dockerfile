FROM python:3.13.15-slim-trixie@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
RUN addgroup --system genithm && adduser --system --ingroup genithm --home /nonexistent --no-create-home genithm \
    && arch="$(dpkg --print-architecture)" \
    && case "$arch" in \
         amd64) mafft_version="7.505-1"; fasttree_version="2.1.11-2" ;; \
         arm64) mafft_version="7.505-1+b1"; fasttree_version="2.1.11-2+b1" ;; \
         *) echo "unsupported architecture: $arch" >&2; exit 2 ;; \
       esac \
    && apt-get update \
    && apt-get install --no-install-recommends -y "mafft=${mafft_version}" "fasttree=${fasttree_version}" \
    && test "$(dpkg-query -W -f='${Version}' mafft)" = "$mafft_version" \
    && test "$(dpkg-query -W -f='${Version}' fasttree)" = "$fasttree_version" \
    && test -x /usr/bin/FastTree \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
COPY genithm_scientific_worker ./genithm_scientific_worker
RUN python -m pip install . \
    && python -m pip uninstall -y pip setuptools
USER genithm
ENTRYPOINT ["genithm-scientific-worker"]
