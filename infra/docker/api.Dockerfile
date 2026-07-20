FROM python:3.12-slim@sha256:423ed6ab25b1921a477529254bfeeabf5855151dc2c3141699a1bfc852199fbf

WORKDIR /app
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-por \
    && rm -rf /var/lib/apt/lists/*
COPY apps/api/requirements-lock.txt apps/api/translation-requirements-lock.txt apps/api/
COPY infra/docker/install_translation_model.py infra/docker/install_translation_model.py
RUN python -m pip install --no-cache-dir --upgrade pip==26.1.2 \
    && python -m pip install --no-cache-dir -r apps/api/requirements-lock.txt \
    && python -m pip install --no-cache-dir -r apps/api/translation-requirements-lock.txt \
    && python infra/docker/install_translation_model.py /opt/brandrt/translation/en-pb

COPY packages/engine packages/engine
COPY apps/api apps/api
RUN python -m pip install --no-cache-dir --no-deps -e packages/engine -e apps/api \
    && python -m pip check \
    && groupadd --system --gid 10001 brandrt \
    && useradd --system --uid 10001 --gid brandrt --home-dir /app --shell /usr/sbin/nologin brandrt \
    && mkdir -p /data \
    && chown -R brandrt:brandrt /app /data

ENV BRANDRT_DATA_DIR=/data
ENV BRANDRT_TRANSLATION_MODEL_DIR=/opt/brandrt/translation/en-pb
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
ENV PYTHONDONTWRITEBYTECODE=1
EXPOSE 8000

USER brandrt

CMD ["brand-api", "serve", "--host", "0.0.0.0", "--port", "8000"]
