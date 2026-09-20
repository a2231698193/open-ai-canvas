# syntax=docker/dockerfile:1.7

ARG BUN_IMAGE=oven/bun:1.3.9
ARG NGINX_IMAGE=nginx:1.27-alpine

# 构建 Vite 前端产物。
FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS web-build

WORKDIR /app/web
ARG NPM_REGISTRY=
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    set -eu; \
    case "$NPM_REGISTRY" in \
      ""|http://*|https://*) ;; \
      *) echo "NPM_REGISTRY must be an http(s) URL" >&2; exit 2 ;; \
    esac; \
    install_web_dependencies() { \
      if [ -n "$NPM_REGISTRY" ]; then \
        bun install --frozen-lockfile --registry "$NPM_REGISTRY" --cache-dir="$1"; \
      else \
        bun install --frozen-lockfile --cache-dir="$1"; \
      fi; \
    }; \
    install_web_dependencies /root/.bun/install/cache || { \
      echo "bun install failed; retrying with an empty cache" >&2; \
      rm -rf node_modules /tmp/bun-install-cache; \
      mkdir -p /tmp/bun-install-cache; \
      install_web_dependencies /tmp/bun-install-cache; \
    }

COPY VERSION /app/VERSION
COPY CHANGELOG.md USER_CHANGELOG.md /app/
COPY README.md CONTRIBUTORS.md /app/
COPY assets /app/assets
COPY web ./
ARG VITE_TLDRAW_LICENSE_KEY
ARG BUILD_VERSION
ENV VITE_TLDRAW_LICENSE_KEY=${VITE_TLDRAW_LICENSE_KEY}
ENV CANVAS_BUILD_VERSION=${BUILD_VERSION}
# 生产镜像只构建云端工作台前端；Agent Runtime 在后端 Worker 中运行。
RUN bun --bun ./node_modules/vite/bin/vite.js build

# 运行镜像：nginx 托管静态前端，并在 Compose 中把 /api 转发到后端服务。
FROM ${NGINX_IMAGE}

COPY --from=web-build /app/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
