FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build

WORKDIR /src
COPY packages/render packages/render
RUN cd packages/render && npm ci && npm run build
COPY apps/web apps/web
RUN cd apps/web && npm ci && npm run build

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

COPY infra/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY infra/docker/validate-web-env.sh /docker-entrypoint.d/05-validate-web-env.sh
RUN chmod +x /docker-entrypoint.d/05-validate-web-env.sh
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
