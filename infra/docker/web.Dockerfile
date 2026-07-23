FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build

WORKDIR /src
COPY packages/render packages/render
RUN cd packages/render && npm ci && npm run build
COPY apps/web apps/web
ARG VITE_SYNAPSIS_FONT_BASE_URL=""
ENV VITE_SYNAPSIS_FONT_BASE_URL=${VITE_SYNAPSIS_FONT_BASE_URL}
RUN cd apps/web && npm ci && npm run build

FROM nginx:1.31.3-alpine-slim@sha256:45b82ed5f285b90d63df07ba70430fdd8f25624b416617d9e6dc93412b2006dc

COPY infra/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY infra/docker/validate-web-env.sh /docker-entrypoint.d/05-validate-web-env.sh
RUN chmod +x /docker-entrypoint.d/05-validate-web-env.sh
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
