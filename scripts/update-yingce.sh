#!/usr/bin/env bash

set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/data/open-ai-canvas}"
BACKUP_ROOT="${BACKUP_ROOT:-/data/open-ai-canvas-backups}"
BACKUP_KEEP_COUNT="${BACKUP_KEEP_COUNT:-2}"
BUILD_CACHE_MAX_SIZE="${BUILD_CACHE_MAX_SIZE:-4GB}"
# 构建缓存决定下一次更新是热构建还是冷构建：Go 标准库和前端的 node_modules
# 都在里面，被清掉就要重编、重下。只在磁盘真的紧张时才动它。
BUILD_CACHE_MIN_FREE_MB="${BUILD_CACHE_MIN_FREE_MB:-5120}"
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
    local value
    value="$(sed -n "s/^${1}=//p" .env | tail -n 1)"
    value="${value%$'\r'}"
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
    printf '%s' "$value"
}

install_update_command() {
    local src="${1:-$INSTALL_DIR/scripts/update-yingce.sh}"
    [[ -f "$src" ]] || return 0
    install -m 0755 "$src" /usr/local/sbin/update-yingce
}

reexec_if_remote_script_changed() {
    [[ "${UPDATE_YINGCE_REEXEC:-}" == "1" ]] && return 0
    local next
    next="$(mktemp)"
    git fetch --prune "$REMOTE" >/dev/null
    if ! git show "${REMOTE}/${BRANCH}:scripts/update-yingce.sh" >"$next" 2>/dev/null; then
        rm -f "$next"
        return 0
    fi
    if cmp -s "$next" "$0"; then
        rm -f "$next"
        return 0
    fi
    install_update_command "$next"
    rm -f "$next"
    printf '已同步 /usr/local/sbin/update-yingce，改用新脚本继续。\n'
    UPDATE_YINGCE_REEXEC=1 exec /usr/local/sbin/update-yingce "$@"
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

host_pg_dump_works() {
    command -v pg_dump >/dev/null 2>&1 && pg_dump --version >/dev/null 2>&1
}

backup_postgres() {
    local dest="$1"
    local url user db image
    url="$(env_value DATABASE_URL)"
    [[ -n "$url" ]] || fail ".env 缺少 DATABASE_URL"
    if uses_compose_postgres && [[ -n "$(compose ps -q postgres 2>/dev/null)" ]]; then
        user="$(env_value POSTGRES_USER)"
        db="$(env_value POSTGRES_DB)"
        [[ -n "$user" && -n "$db" ]] || fail ".env 缺少 POSTGRES_USER 或 POSTGRES_DB"
        compose exec -T postgres pg_dump -U "$user" -d "$db" -Fc >"$dest"
    elif host_pg_dump_works; then
        pg_dump --dbname="$url" -Fc >"$dest"
    else
        image="$(env_value POSTGRES_IMAGE)"
        image="${image:-docker.m.daocloud.io/library/postgres:17-alpine}"
        printf '主机没有可用的 pg_dump，改用镜像 %s 备份外部数据库。\n' "$image"
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
        tar_allow_changed tar -C "$data_path" -czf "$dest" .
        [[ -s "$dest" ]] || fail "后端数据备份为空"
        return
    fi
    if docker image inspect open-ai-canvas-backend:server >/dev/null 2>&1; then
        tar_allow_changed compose run --rm --no-deps --user 0 --entrypoint tar backend czf - -C /data . >"$dest"
        [[ -s "$dest" ]] || fail "后端数据备份为空"
        return
    fi
    local volume
    volume="$(docker volume ls -q --filter name=backend-data | awk 'NR==1{print}')"
    [[ -n "$volume" ]] || fail "找不到后端数据卷，无法备份"
    tar_allow_changed docker run --rm -v "$volume:/data:ro" "${ALPINE_IMAGE:-docker.m.daocloud.io/library/alpine:3.22}" tar czf - -C /data . >"$dest"
    [[ -s "$dest" ]] || fail "后端数据备份为空"
}

# 备份运行中的数据目录时，插件等临时文件可能在打包期间被修改或删除，
# 此时 tar 返回 1 但备份仍可用；只有 >=2 才是致命错误。
tar_allow_changed() {
    local rc=0
    "$@" || rc=$?
    if [[ "$rc" -eq 1 ]]; then
        printf '警告：备份期间有文件被修改或删除，已忽略并继续。\n' >&2
        return 0
    fi
    return "$rc"
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

cleanup_old_backups() {
    local -a backups=()
    local backup index
    while IFS= read -r backup; do
        if [[ -s "${backup}/env" && -s "${backup}/postgres.dump" && -s "${backup}/backend-data.tar.gz" ]]; then
            backups+=("$backup")
        elif ! rm -rf -- "$backup"; then
            printf '警告：无法清理不完整备份 %s\n' "$backup" >&2
        fi
    done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '????????-??????' -print | sort -r)
    for ((index = BACKUP_KEEP_COUNT; index < ${#backups[@]}; index++)); do
        if ! rm -rf -- "${backups[$index]}"; then
            printf '警告：无法清理旧备份 %s\n' "${backups[$index]}" >&2
        fi
    done
}

cleanup_old_rollback_images() {
    local keep_prefix="$1"
    local repository image
    for repository in open-ai-canvas-backend open-ai-canvas-web; do
        while IFS= read -r image; do
            [[ -z "$image" || "$image" == "${repository}:rollback-${keep_prefix}" ]] && continue
            docker image rm "$image" >/dev/null || printf '警告：无法清理旧回退镜像 %s\n' "$image" >&2
        done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' --filter "reference=${repository}:rollback-*")
    done
}

docker_available_mb() {
    local target="/var/lib/docker"
    [[ -d "$target" ]] || target="/"
    df -Pm "$target" 2>/dev/null | awk 'NR == 2 { print $4 }'
}

# BuildKit 缓存里带着 Go 的编译缓存和前端依赖。`--all` 会把它们一起删掉，
# 于是下一次更新变成冷构建，后端编译和前端安装都会多花好几分钟。
# 因此默认不清理，只在可用磁盘低于阈值时才做一次彻底清理，并接受随之而来的冷构建。
prune_build_cache() {
    local available min_free
    min_free="${BUILD_CACHE_MIN_FREE_MB}"
    [[ "$min_free" =~ ^[1-9][0-9]*$ ]] || fail "BUILD_CACHE_MIN_FREE_MB 必须是正整数"
    if [[ -z "${FORCE_BUILD_CACHE_PRUNE:-}" ]]; then
        available="$(docker_available_mb)"
        if [[ -z "$available" ]]; then
            printf '警告：无法读取磁盘可用空间，已跳过 BuildKit 缓存清理。\n' >&2
            return 0
        fi
        if (( available >= min_free )); then
            printf '磁盘可用 %sMB，保留 BuildKit 缓存以加快下次更新。\n' "$available"
            return 0
        fi
        printf '磁盘可用 %sMB，低于 %sMB，清理 BuildKit 缓存。\n' "$available" "$min_free"
    fi
    if ! docker buildx prune --all --force --max-used-space "$BUILD_CACHE_MAX_SIZE"; then
        printf '警告：BuildKit 缓存清理失败，请稍后手工执行 docker buildx prune。\n' >&2
    fi
}

cleanup_after_update() {
    local rollback_prefix="$1"
    step "轮转更新备份与 Docker 缓存"
    cleanup_old_backups
    cleanup_old_rollback_images "$rollback_prefix"
    prune_build_cache
}

wait_health() {
    local bind="${1:-3000}"
    local host="127.0.0.1"
    local port="$bind"
    if [[ "$bind" == *:* ]]; then
        host="${bind%:*}"
        port="${bind##*:}"
        [[ -n "$host" ]] || host="127.0.0.1"
    fi
    local url="http://${host}:${port}/api/health/ready"
    local attempt
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
        if curl -fsS "$url" >/dev/null; then
            printf '本机健康检查通过：%s\n' "$url"
            return 0
        fi
        sleep 3
    done
    printf '服务已启动，但 %s 未通过健康检查。\n' "$url" >&2
    return 1
}

mem_available_mb() {
    local meminfo="$1"
    [[ -r "$meminfo" ]] || return 1
    awk '/^MemAvailable:/ { printf "%d\n", $2 / 1024; found = 1 } END { exit found ? 0 : 1 }' "$meminfo"
}

memory_is_sufficient() {
    local available="$1"
    local minimum="$2"
    (( available >= minimum ))
}

require_free_memory() {
    local available minimum="${MIN_FREE_MEMORY_MB:-1024}"
    [[ "$minimum" =~ ^[1-9][0-9]*$ ]] || fail "MIN_FREE_MEMORY_MB 必须是正整数"
    available="$(mem_available_mb /proc/meminfo)" || fail "无法读取可用内存，已拒绝更新，线上容器未切换"
    if ! memory_is_sufficient "$available" "$minimum"; then
        fail "可用内存 ${available}MB，低于 ${minimum}MB，已拒绝更新，线上容器未切换。确认内存充足后可临时执行：sudo MIN_FREE_MEMORY_MB=... /usr/local/sbin/update-yingce"
    fi
    printf '可用内存 %sMB，要求至少 %sMB。\n' "$available" "$minimum"
}

protect_running_services() {
    local score="${SERVICE_OOM_SCORE_ADJ:--500}"
    local id found=0
    [[ "$score" =~ ^-?[0-9]+$ ]] || fail "SERVICE_OOM_SCORE_ADJ 必须是整数"
    (( score >= -1000 && score <= 1000 )) || fail "SERVICE_OOM_SCORE_ADJ 必须在 -1000 到 1000 之间"
    while IFS= read -r id; do
        [[ -z "$id" ]] && continue
        found=1
        if docker update --oom-score-adj "$score" "$id" >/dev/null; then
            printf '已保护运行中的容器 %s（oom_score_adj=%s）。\n' "$id" "$score"
        else
            printf '警告：无法设置容器 %s 的 OOM 优先级。\n' "$id" >&2
        fi
    done < <(compose ps -q backend web redis 2>/dev/null || true)
    if (( found == 0 )); then
        printf '没有正在运行的 backend、web 或 redis 容器，跳过 OOM 保护。\n'
    fi
}

release_rollback_notice() {
    local migration_started="$1"
    local backup_dir="$2"
    if [[ "$migration_started" == "1" ]]; then
        printf '数据库迁移步骤已开始。本次只回退前后端镜像，不恢复数据库。备份目录：%s' "$backup_dir"
        return 0
    fi
    printf '数据库迁移尚未执行。本次只回退前后端镜像。备份目录：%s' "$backup_dir"
}

switch_services() {
    if uses_compose_postgres; then
        migration_started=1
        compose up -d --remove-orphans --wait --wait-timeout 600
        return
    fi
    compose stop postgres >/dev/null 2>&1 || true
    compose rm -f postgres >/dev/null 2>&1 || true
    compose up -d redis --wait --wait-timeout 120
    migration_started=1
    compose run --rm --no-deps migrate
    compose up -d --no-deps --remove-orphans --wait --wait-timeout 600 backend web
}

restore_previous_release() {
    local prefix="$1"
    local repository image
    for repository in open-ai-canvas-backend open-ai-canvas-web; do
        image="${repository}:rollback-${prefix}"
        if ! docker image inspect "$image" >/dev/null 2>&1; then
            printf '缺少回退镜像 %s。\n' "$image" >&2
            return 1
        fi
    done
    for repository in open-ai-canvas-backend open-ai-canvas-web; do
        docker tag "${repository}:rollback-${prefix}" "${repository}:server"
    done
    compose stop --timeout "${ROLLBACK_STOP_TIMEOUT:-20}" backend web >/dev/null 2>&1 || true
    compose up -d --no-deps --force-recreate --wait --wait-timeout 180 backend web
}

main() {
    require_root
    command -v git >/dev/null 2>&1 || fail "未安装 git"
    command -v docker >/dev/null 2>&1 || fail "未安装 docker"
    docker compose version >/dev/null 2>&1 || fail "未安装 Docker Compose"
    command -v curl >/dev/null 2>&1 || fail "未安装 curl"
    [[ "$BACKUP_KEEP_COUNT" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_KEEP_COUNT 必须是正整数"

    [[ -d "$INSTALL_DIR/.git" ]] || fail "未找到 Git 仓库：$INSTALL_DIR"
    cd "$INSTALL_DIR"
    [[ -f .env ]] || fail "未找到 $INSTALL_DIR/.env"
    [[ -f "$COMPOSE_FILE" && -f "$BUILD_COMPOSE_FILE" ]] || fail "未找到部署 Compose 文件"
    reexec_if_remote_script_changed "$@"
    require_clean_worktree

    local old_commit old_short stamp backup_dir port migration_started=0
    require_free_memory
    old_commit="$(git rev-parse HEAD)"
    old_short="$(git rev-parse --short=12 HEAD)"
    stamp="$(date +%Y%m%d-%H%M%S)"
    backup_dir="${BACKUP_ROOT}/${stamp}"
    port="$(env_value CANVAS_HTTP_PORT)"
    port="${port:-3000}"

    step "备份当前版本 ${old_short}"
    install -d -m 0700 "$backup_dir"
    (
        umask 077
        cp -a .env "${backup_dir}/env"
        backup_postgres "${backup_dir}/postgres.dump"
        backup_backend_data "${backup_dir}/backend-data.tar.gz"
    )
    tag_rollback_images "$old_short"
    printf '备份目录：%s\n' "$backup_dir"

    step "快进更新到 ${REMOTE}/${BRANCH}"
    git fetch --prune "$REMOTE"
    git merge --ff-only "${REMOTE}/${BRANCH}"
    install_update_command
    require_clean_worktree

    local new_commit
    new_commit="$(git rev-parse HEAD)"
    if [[ "$new_commit" == "$old_commit" ]]; then
        printf '代码已是 %s/%s 最新提交，仍将按当前源码重建并重启服务。\n' "$REMOTE" "$BRANCH"
    fi

    require_free_memory
    protect_running_services
    # 编译默认用满所有核心。只有在内存确实不够、必须压低编译峰值时才临时设置这两个变量。
    export BUILD_GOMAXPROCS="${BUILD_GOMAXPROCS:-}"
    export BUILD_GOGC="${BUILD_GOGC:-}"

    step "串行构建后端镜像"
    if ! COMPOSE_PARALLEL_LIMIT=1 compose build backend; then
        fail "后端镜像构建失败，线上容器未切换。请勿继续清理 Docker。"
    fi
    step "串行构建前端镜像"
    if ! COMPOSE_PARALLEL_LIMIT=1 compose build web; then
        fail "前端镜像构建失败，线上容器未切换。请勿继续清理 Docker。"
    fi

    step "迁移数据库并重启服务"
    if ! switch_services || ! wait_health "$port"; then
        step "新版本未就绪，切回更新前的前后端镜像"
        printf '%s\n' "$(release_rollback_notice "$migration_started" "$backup_dir")" >&2
        if restore_previous_release "$old_short" && wait_health "$port"; then
            fail "已切回旧版本容器，更新未完成。备份和回退镜像已保留：${backup_dir}"
        fi
        fail "自动回退失败。请勿继续重建或清理 Docker。备份目录：${backup_dir}。回退镜像：rollback-${old_short}"
    fi
    cleanup_after_update "$old_short"

    printf '\n更新完成。\n'
    git log -1 --oneline --decorate
    compose ps
}

# 同 install-linggan.sh：管道执行时 BASH_SOURCE 未定义，直接展开会被 set -u 打死；
# 回落到 $0，既支持 `… | bash`，又保证被 source（测试）时不自动执行 main。
if [[ "${BASH_SOURCE[0]:-$0}" == "$0" ]]; then
    main "$@"
fi
