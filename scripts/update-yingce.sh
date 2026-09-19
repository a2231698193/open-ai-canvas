#!/usr/bin/env bash

set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/data/open-ai-canvas}"
BACKUP_ROOT="${BACKUP_ROOT:-/data/open-ai-canvas-backups}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="docker-compose.deploy.yml"
BUILD_COMPOSE_FILE="docker-compose.build.yml"
EXTERNAL_POSTGRES_COMPOSE_FILE="docker-compose.external-postgres.yml"

step() {
    printf '\n==> %s\n' "$1"
}

fail() {
    printf '\n更新失败：%s\n' "$1" >&2
    exit 1
}

require_root() {
    if [[ "${EUID}" -ne 0 ]]; then
        fail "请使用 sudo /usr/local/sbin/update-yingce"
    fi
}

env_value() {
    sed -n "s/^${1}=//p" .env | tail -n 1
}

database_url_host() {
    local url host
    url="$(env_value DATABASE_URL)"
    url="${url#*@}"
    host="${url%%[:/?]*}"
    printf '%s' "$host"
}

uses_compose_postgres() {
    [[ "$(database_url_host)" == "postgres" ]]
}

compose() {
    local files=(--env-file .env -f "$COMPOSE_FILE" -f "$BUILD_COMPOSE_FILE")
    if ! uses_compose_postgres && [[ -f "$EXTERNAL_POSTGRES_COMPOSE_FILE" ]]; then
        files+=(-f "$EXTERNAL_POSTGRES_COMPOSE_FILE")
    fi
    docker compose "${files[@]}" "$@"
}

require_clean_worktree() {
    [[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail "$INSTALL_DIR 存在本地代码改动，请先处理后再更新"
}

backup_postgres() {
    local dest="$1"
    local url user db
    url="$(env_value DATABASE_URL)"
    [[ -n "$url" ]] || fail ".env 缺少 DATABASE_URL"
    if uses_compose_postgres && [[ -n "$(compose ps -q postgres 2>/dev/null)" ]]; then
        user="$(env_value POSTGRES_USER)"
        db="$(env_value POSTGRES_DB)"
        [[ -n "$user" && -n "$db" ]] || fail ".env 缺少 POSTGRES_USER 或 POSTGRES_DB"
        compose exec -T postgres pg_dump -U "$user" -d "$db" -Fc >"$dest"
    elif command -v pg_dump >/dev/null 2>&1; then
        pg_dump --dbname="$url" -Fc >"$dest"
    else
        local image
        image="$(env_value POSTGRES_IMAGE)"
        image="${image:-docker.m.daocloud.io/library/postgres:17-alpine}"
        docker run --rm --network host "$image" pg_dump --dbname="$url" -Fc >"$dest"
    fi
    [[ -s "$dest" ]] || fail "PostgreSQL 备份为空"
}

backup_backend_data() {
    local dest="$1"
    local data_path
    local ALPINE_IMAGE
    data_path="$(env_value CANVAS_DATA_PATH)"
    ALPINE_IMAGE="$(env_value ALPINE_IMAGE)"
    if [[ -n "$data_path" ]]; then
        [[ -d "$data_path" ]] || fail "CANVAS_DATA_PATH 不是目录：$data_path"
        tar -C "$data_path" -czf "$dest" .
        return
    fi
    if docker image inspect open-ai-canvas-backend:server >/dev/null 2>&1; then
        compose run --rm --no-deps --user 0 --entrypoint tar backend czf - -C /data . >"$dest"
        return
    fi
    local volume
    volume="$(docker volume ls -q --filter name=backend-data | awk 'NR==1{print}')"
    [[ -n "$volume" ]] || fail "找不到后端数据卷，无法备份"
    docker run --rm -v "$volume:/data:ro" "${ALPINE_IMAGE:-docker.m.daocloud.io/library/alpine:3.22}" tar czf - -C /data . >"$dest"
}

tag_rollback_images() {
    local prefix="$1"
    if docker image inspect open-ai-canvas-backend:server >/dev/null 2>&1; then
        docker tag open-ai-canvas-backend:server "open-ai-canvas-backend:rollback-${prefix}"
    fi
    if docker image inspect open-ai-canvas-web:server >/dev/null 2>&1; then
        docker tag open-ai-canvas-web:server "open-ai-canvas-web:rollback-${prefix}"
    fi
}

wait_health() {
    local port="$1"
    local url="http://127.0.0.1:${port}/api/health/ready"
    local attempt
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
        if curl -fsS "$url" >/dev/null; then
            printf '本机健康检查通过：%s\n' "$url"
            return
        fi
        sleep 3
    done
    fail "服务已启动，但 ${url} 未通过健康检查"
}

main() {
    require_root
    command -v git >/dev/null 2>&1 || fail "未安装 git"
    command -v docker >/dev/null 2>&1 || fail "未安装 docker"
    docker compose version >/dev/null 2>&1 || fail "未安装 Docker Compose"
    command -v curl >/dev/null 2>&1 || fail "未安装 curl"

    [[ -d "$INSTALL_DIR/.git" ]] || fail "未找到 Git 仓库：$INSTALL_DIR"
    cd "$INSTALL_DIR"
    [[ -f .env ]] || fail "未找到 $INSTALL_DIR/.env"
    [[ -f "$COMPOSE_FILE" && -f "$BUILD_COMPOSE_FILE" ]] || fail "未找到部署 Compose 文件"
    require_clean_worktree

    local old_commit old_short stamp backup_dir port
    old_commit="$(git rev-parse HEAD)"
    old_short="$(git rev-parse --short=12 HEAD)"
    stamp="$(date +%Y%m%d-%H%M%S)"
    backup_dir="${BACKUP_ROOT}/${stamp}"
    port="$(env_value CANVAS_HTTP_PORT)"
    port="${port:-3000}"

    step "备份当前版本 ${old_short}"
    install -d -m 0700 "$backup_dir"
    umask 077
    cp -a .env "${backup_dir}/env"
    backup_postgres "${backup_dir}/postgres.dump"
    backup_backend_data "${backup_dir}/backend-data.tar.gz"
    tag_rollback_images "$old_short"
    printf '备份目录：%s\n' "$backup_dir"

    step "快进更新到 ${REMOTE}/${BRANCH}"
    git fetch --prune "$REMOTE"
    git merge --ff-only "${REMOTE}/${BRANCH}"
    require_clean_worktree

    local new_commit
    new_commit="$(git rev-parse HEAD)"
    if [[ "$new_commit" == "$old_commit" ]]; then
        printf '代码已是 %s/%s 最新提交，仍将按当前源码重建并重启服务。\n' "$REMOTE" "$BRANCH"
    fi

    step "串行构建后端镜像"
    COMPOSE_PARALLEL_LIMIT=1 compose build backend
    step "串行构建前端镜像"
    COMPOSE_PARALLEL_LIMIT=1 compose build web

    step "迁移数据库并重启服务"
    if uses_compose_postgres; then
        compose up -d --remove-orphans --wait --wait-timeout 600
    else
        compose stop postgres >/dev/null 2>&1 || true
        compose rm -f postgres >/dev/null 2>&1 || true
        compose up -d redis --wait --wait-timeout 120
        compose run --rm --no-deps migrate
        compose up -d --no-deps --remove-orphans --wait --wait-timeout 600 backend web
    fi
    wait_health "$port"

    printf '\n更新完成。\n'
    git log -1 --oneline --decorate
    compose ps
}

main "$@"
