FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS render

WORKDIR /src
COPY packages/render packages/render
RUN cd packages/render && npm ci && npm run build

FROM mcr.microsoft.com/playwright/python:v1.61.0-noble@sha256:a9731514f24121d1dcd25d58d0a38146646d290a5998fd80d3e533e7b5e21c69

WORKDIR /app
COPY packages/engine packages/engine
COPY apps/api apps/api
RUN python -m pip install --no-cache-dir --upgrade pip==26.1.2 \
    && python -m pip install --no-cache-dir \
      -r packages/engine/requirements-lock.txt \
      -r apps/api/requirements-lock.txt \
    && python -m pip install --no-cache-dir --no-deps -e packages/engine -e apps/api \
    && python -m pip check
COPY --from=render /src/packages/render/dist /app/render-dist
RUN groupadd --system --gid 10001 brandrt \
    && useradd --system --uid 10001 --gid brandrt --home-dir /tmp --shell /usr/sbin/nologin brandrt \
    && mkdir -p /data \
    && chown -R brandrt:brandrt /app /data

ENV BRANDRT_RENDER_DIST=/app/render-dist
ENV BRANDRT_DATA_DIR=/data
ENV HOME=/tmp
ENV PYTHONDONTWRITEBYTECODE=1

USER brandrt

CMD ["brand-api", "worker"]
