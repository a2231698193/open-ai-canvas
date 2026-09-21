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
