FROM python:3.14-slim@sha256:cea0e6040540fb2b965b6e7fb5ffa00871e632eef63719f0ea54bca189ce14a6

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        fontconfig \
        fonts-liberation2 \
        libreoffice-impress \
        libreoffice-writer \
    && rm -rf /var/lib/apt/lists/*

COPY packages/engine packages/engine
RUN python -m pip install --no-cache-dir --upgrade pip==26.1.2 \
    && python -m pip install --no-cache-dir -r packages/engine/requirements-lock.txt \
    && python -m pip install --no-cache-dir --no-deps -e packages/engine \
    && python -m pip check \
    && groupadd --system --gid 10002 preview \
    && useradd --system --uid 10002 --gid preview --home-dir /work --shell /usr/sbin/nologin preview \
    && mkdir -p /work \
    && chown preview:preview /work

ENV HOME=/work
ENV PYTHONDONTWRITEBYTECODE=1

USER preview

ENTRYPOINT ["brandrt"]
CMD ["--help"]
