# syntax=docker/dockerfile:1.7

ARG BUN_IMAGE=oven/bun:1.3.9
ARG NGINX_IMAGE=nginx:1.27-alpine

# 构建 Vite 前端产物。
FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS web-build

# Bun 1.3.13 的流式解包在部分镜像源/缓存组合下会误报 tarball 完整性失败。
ENV BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL=1 \
    BUN_CONFIG_MAX_HTTP_REQUESTS=8

WORKDIR /app/web
ARG NPM_REGISTRY=
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    set -eu; \
    case "$NPM_REGISTRY" in \
      ""|http://*|https://*) ;; \
      *) echo "NPM_REGISTRY must be an http(s) URL" >&2; exit 2 ;; \
    esac; \
    install_web_dependencies() { \
      if [ -n "$2" ]; then \
        bun install --frozen-lockfile --network-concurrency=8 --registry "$2" --cache-dir="$1"; \
      else \
        bun install --frozen-lockfile --network-concurrency=8 --cache-dir="$1"; \
      fi; \
    }; \
    attempt=1; \
    while [ "$attempt" -le 4 ]; do \
      registry="$NPM_REGISTRY"; \
      case "$attempt:$NPM_REGISTRY" in \
        3:https://registry.npmmirror.com|3:https://registry.npmmirror.com/) \
          registry=https://registry.npmjs.org; \
          echo "bun install: falling back to the npm registry" >&2 ;; \
      esac; \
      case "$registry" in \
        https://registry.npmmirror.com|https://registry.npmmirror.com/|https://registry.npmjs.org|https://registry.npmjs.org/) \
          lock_registry=${registry%/}; \
          sed -i \
            -e "s#https://registry\\.npmmirror\\.com/#$lock_registry/#g" \
            -e "s#https://registry\\.npmjs\\.org/#$lock_registry/#g" \
            bun.lock ;; \
      esac; \
      if [ "$attempt" -eq 1 ]; then \
        cache_dir=/root/.bun/install/cache; \
      else \
        cache_dir="/tmp/bun-install-cache-$attempt"; \
        rm -rf node_modules "$cache_dir"; \
        mkdir -p "$cache_dir"; \
      fi; \
      if install_web_dependencies "$cache_dir" "$registry"; then \
        exit 0; \
      fi; \
      echo "bun install failed (attempt $attempt/4); retrying with a fresh cache" >&2; \
      if [ "$attempt" -lt 4 ]; then sleep "$((attempt * 2))"; fi; \
      attempt=$((attempt + 1)); \
    done; \
    exit 1

COPY VERSION /app/VERSION
COPY CHANGELOG.md USER_CHANGELOG.md /app/
COPY README.md CONTRIBUTORS.md /app/
COPY assets /app/assets
COPY web ./
ARG VITE_TLDRAW_LICENSE_KEY
ARG BUILD_VERSION
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown
ENV VITE_TLDRAW_LICENSE_KEY=${VITE_TLDRAW_LICENSE_KEY}
ENV CANVAS_BUILD_VERSION=${BUILD_VERSION}
ENV CANVAS_BUILD_COMMIT=${BUILD_COMMIT}
ENV CANVAS_BUILD_TIME=${BUILD_TIME}
# 生产镜像只构建云端工作台前端；Agent Runtime 在后端 Worker 中运行。
RUN bun --bun ./node_modules/vite/bin/vite.js build

# 运行镜像：nginx 托管静态前端，并在 Compose 中把 /api 转发到后端服务。
FROM ${NGINX_IMAGE}

COPY --from=web-build /app/web/dist /opt/canvas-release
COPY docker/canvas-web-entrypoint.sh /usr/local/bin/canvas-web-entrypoint
RUN chmod +x /usr/local/bin/canvas-web-entrypoint
COPY nginx.conf /etc/nginx/conf.d/default.conf

ENTRYPOINT ["/usr/local/bin/canvas-web-entrypoint"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
