FROM nginx:1.30.3-alpine-slim@sha256:d5b51cfc7d55fc7a7bcf4d1d577b9c3738331df56d68f0b1d8ac9795b9470a5a

COPY infra/docker/font-fetch-nginx.conf /etc/nginx/nginx.conf
COPY infra/docker/font-fetch.conf /etc/nginx/conf.d/default.conf
