FROM nginx:1.31.3-alpine-slim@sha256:45b82ed5f285b90d63df07ba70430fdd8f25624b416617d9e6dc93412b2006dc

COPY infra/docker/font-fetch-nginx.conf /etc/nginx/nginx.conf
COPY infra/docker/font-fetch.conf /etc/nginx/conf.d/default.conf
