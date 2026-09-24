#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ROOT="$(mktemp -d)"
BACKUP_KEEP_COUNT=2
trap 'rm -rf "$BACKUP_ROOT"' EXIT

source "${SCRIPT_DIR}/update-yingce.sh"

mkdir -p \
    "${BACKUP_ROOT}/20260920-203614" \
    "${BACKUP_ROOT}/20260920-205029" \
    "${BACKUP_ROOT}/20260920-211234" \
    "${BACKUP_ROOT}/20260920-212000" \
    "${BACKUP_ROOT}/unrelated"
for backup in 20260920-203614 20260920-205029 20260920-211234; do
    printf 'env' >"${BACKUP_ROOT}/${backup}/env"
    printf 'database' >"${BACKUP_ROOT}/${backup}/postgres.dump"
    printf 'data' >"${BACKUP_ROOT}/${backup}/backend-data.tar.gz"
done

cleanup_old_backups

[[ -d "${BACKUP_ROOT}/20260920-211234" ]]
[[ -d "${BACKUP_ROOT}/20260920-205029" ]]
[[ ! -e "${BACKUP_ROOT}/20260920-203614" ]]
[[ ! -e "${BACKUP_ROOT}/20260920-212000" ]]
[[ -d "${BACKUP_ROOT}/unrelated" ]]

printf 'update-yingce backup retention: ok\n'

# 备份 tar 退出码：1 视为可接受，2 及以上仍然失败
tar_allow_changed bash -c 'exit 1'
if tar_allow_changed bash -c 'exit 2'; then
    printf 'expected rc 2 to fail\n' >&2
    exit 1
fi
if tar_allow_changed bash -c 'exit 0'; then
    :
else
    printf 'expected rc 0 to pass\n' >&2
    exit 1
fi

printf 'update-yingce tar backup tolerance: ok\n'

meminfo="$(mktemp)"
printf 'MemTotal:       8000000 kB\nMemAvailable:   2097152 kB\n' >"$meminfo"
[[ "$(mem_available_mb "$meminfo")" == "2048" ]]
memory_is_sufficient 2048 1024
if memory_is_sufficient 512 1024; then
    printf 'expected insufficient memory to fail\n' >&2
    exit 1
fi
if mem_available_mb "${meminfo}.missing"; then
    printf 'expected missing meminfo to fail\n' >&2
    exit 1
fi
rm -f "$meminfo"
printf 'update-yingce memory gate: ok\n'

[[ "$(release_rollback_notice 0 /tmp/backup)" == "数据库迁移尚未执行。本次只回退前后端镜像。备份目录：/tmp/backup" ]]
[[ "$(release_rollback_notice 1 /tmp/backup)" == "数据库迁移步骤已开始。本次只回退前后端镜像，不恢复数据库。备份目录：/tmp/backup" ]]
printf 'update-yingce rollback notice: ok\n'

# BuildKit 缓存带着 Go 编译缓存和前端依赖：默认保留，只在磁盘紧张或显式要求时清理。
docker_calls=0
docker() { docker_calls=$((docker_calls + 1)); return 0; }
docker_available_mb() { printf '%s\n' "${FAKE_AVAILABLE_MB}"; }

FAKE_AVAILABLE_MB=20480
docker_calls=0
prune_build_cache >/dev/null
[[ "$docker_calls" -eq 0 ]] || { printf 'expected a warm cache to be kept\n' >&2; exit 1; }

FAKE_AVAILABLE_MB=1024
docker_calls=0
prune_build_cache >/dev/null
[[ "$docker_calls" -eq 1 ]] || { printf 'expected low disk to prune\n' >&2; exit 1; }

FAKE_AVAILABLE_MB=20480
docker_calls=0
FORCE_BUILD_CACHE_PRUNE=1 prune_build_cache >/dev/null
[[ "$docker_calls" -eq 1 ]] || { printf 'expected the explicit override to prune\n' >&2; exit 1; }

if (BUILD_CACHE_MIN_FREE_MB=abc prune_build_cache) >/dev/null 2>&1; then
    printf 'expected an invalid cache threshold to fail\n' >&2
    exit 1
fi

printf 'update-yingce build cache retention: ok\n'

# 部署 Compose 只能用源码构建流程能提供的变量：上线时 `compose build backend` 之前会先解析整个
# 文件，任何 `${VAR:?}` 缺失都会当场报错并中止更新。上游曾把三个服务的镜像改成"必须带 digest 的
# CANVAS_BACKEND_IMAGE/CANVAS_WEB_IMAGE"，合并时漏改就让线上更新直接失败——这里钉住这条边界。
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.deploy.yml"
[[ -f "$COMPOSE_FILE" ]] || { printf 'missing %s\n' "$COMPOSE_FILE" >&2; exit 1; }

required="$(grep -o '\${[A-Z_]*:?' "$COMPOSE_FILE" | sed 's/^\${//; s/:?$//' | sort -u)"
expected=$'DATABASE_URL\nPOSTGRES_PASSWORD'
if [[ "$required" != "$expected" ]]; then
    printf 'docker-compose.deploy.yml 新增了必填变量（源码构建流程提供不了，会让更新在解析阶段失败）：\n%s\n' "$required" >&2
    exit 1
fi
for service in migrate backend web; do
    line="$(awk -v service="  ${service}:" '$0 == service {found=1; next} found && /^    image:/ {print; exit}' "$COMPOSE_FILE")"
    [[ "$line" == *'${CANVAS_IMAGE_TAG:-latest}'* ]] || {
        printf '%s 的镜像必须是带默认值的 ${CANVAS_IMAGE_TAG}：%s\n' "$service" "$line" >&2
        exit 1
    }
done

printf 'update-yingce deploy compose contract: ok\n'
