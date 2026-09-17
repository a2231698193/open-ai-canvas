#!/usr/bin/env bash
# 导出问鼎（LK888）渠道的模型参数与价格，供审计/对账使用。
#
# 只读：不写数据库；导出时排除 model_channels.api_key / secret_key / headers_json。
# 用法（在生产部署目录执行）：
#   sudo bash scripts/export-lk888-audit.sh --match lk888
#   sudo bash scripts/export-lk888-audit.sh --channel-id CHANNEL_000004
# 产物：/tmp/lk888-audit-<时间戳>/{channels.txt,model_channels.csv,channel_models.csv,channel_model_price_tiers.csv,model_price_report.csv}

# 允许用 sh 调用：Debian/Ubuntu 的 sh 是 dash，不支持 set -o pipefail，这里自动切回 bash。
if [ -z "${BASH_VERSION:-}" ]; then
    if command -v bash >/dev/null 2>&1; then
        exec bash "$0" "$@"
    fi
    echo "本脚本需要 bash（dash/sh 不支持 set -o pipefail）：请用 bash $(basename "$0") 执行。" >&2
    exit 1
fi

set -euo pipefail

OUT_DIR="/tmp/lk888-audit-$(date +%Y%m%d-%H%M%S)"
COMPOSE_FILE="docker-compose.deploy.yml"
CHANNEL_ID=""
CHANNEL_MATCH=""
NO_SUDO=0

usage() {
    cat <<'USAGE'
用法: bash export-lk888-audit.sh [选项]

  --out DIR            产物目录，默认 /tmp/lk888-audit-<时间戳>
  --compose-file FILE  编排文件，默认 docker-compose.deploy.yml
  --channel-id ID      只导出指定渠道（先跑一次不带参数的，从 channels.txt 里取 ID）
  --match TEXT         按渠道名/别名/base_url 模糊过滤，例如 --match lk888
  --no-sudo            当前用户已有 docker 权限时使用
  -h, --help           显示本帮助
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --out) OUT_DIR="$2"; shift 2 ;;
        --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
        --channel-id) CHANNEL_ID="$2"; shift 2 ;;
        --match) CHANNEL_MATCH="$2"; shift 2 ;;
        --no-sudo) NO_SUDO=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "未知参数: $1" >&2; usage; exit 2 ;;
    esac
done

case "${CHANNEL_ID}${CHANNEL_MATCH}" in
    *"'"*) echo "渠道过滤参数不能包含单引号" >&2; exit 2 ;;
esac

if [ -f "$COMPOSE_FILE" ]; then
    DEPLOY_DIR="$PWD"
elif [ -f "$(dirname "$0")/../$COMPOSE_FILE" ]; then
    DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
else
    echo "找不到 $COMPOSE_FILE：请在部署目录执行，或用 --compose-file 指定路径" >&2
    exit 1
fi
cd "$DEPLOY_DIR"

if [ ! -f .env ]; then
    echo "当前目录没有 .env（compose 需要它提供数据库连接）；请确认在部署目录执行。" >&2
    exit 1
fi

if [ "$NO_SUDO" = "1" ]; then
    SUDO=""
elif docker info >/dev/null 2>&1; then
    SUDO=""
else
    SUDO="sudo"
fi

if $SUDO docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="$SUDO docker compose"
elif $SUDO docker-compose version >/dev/null 2>&1; then
    COMPOSE_CMD="$SUDO docker-compose"
else
    echo "找不到 docker compose / docker-compose" >&2
    exit 1
fi

compose() {
    $COMPOSE_CMD --env-file .env -f "$COMPOSE_FILE" "$@"
}

# psql 走容器内部环境变量，所以 .env 改过库名/用户名也不用调整脚本。
psql_stdin() {
    compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q'
}

run_sql() {
    printf '%s\n' "$1" | psql_stdin
}

# 只取值：元组模式 + 非对齐，空结果就是空字符串，便于判断。
run_sql_value() {
    printf '%s\n' "$1" | compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q -t -A'
}

copy_csv() {
    # $1 = 输出文件，$2 = COPY 语句
    # 去掉可能的命令状态行（如 "COPY 12"），避免污染 CSV。
    printf '%s\n' "$2" | psql_stdin | sed '/^COPY [0-9][0-9]*$/d' > "$1"
    if [ ! -s "$1" ]; then
        echo "导出失败（文件为空）：$1" >&2
        exit 1
    fi
}

mkdir -p "$OUT_DIR"

echo "==> 部署目录: $DEPLOY_DIR"
echo "==> 产物目录: $OUT_DIR"

echo "==> 检查表结构"
missing="$(run_sql_value "SELECT coalesce(string_agg(name, ', '), '') FROM (VALUES ('model_channels'), ('channel_models'), ('channel_model_price_tiers')) AS t(name) WHERE to_regclass('public.' || name) IS NULL;")"
if [ -n "$missing" ]; then
    echo "缺少表: $missing" >&2
    echo "如果生产不是 PostgreSQL 部署（例如 SQLite 单机版），请改用对应的导出方式。" >&2
    exit 1
fi

if [ -n "$CHANNEL_ID" ]; then
    CHANNEL_PREDICATE="id = '${CHANNEL_ID}'"
elif [ -n "$CHANNEL_MATCH" ]; then
    CHANNEL_PREDICATE="(name ILIKE '%${CHANNEL_MATCH}%' OR public_alias ILIKE '%${CHANNEL_MATCH}%' OR base_url ILIKE '%${CHANNEL_MATCH}%')"
else
    CHANNEL_PREDICATE=""
fi

channels_where="deleted_at IS NULL"
models_where="deleted_at IS NULL"
tiers_where="deleted_at IS NULL"
if [ -n "$CHANNEL_PREDICATE" ]; then
    channels_where="$channels_where AND ($CHANNEL_PREDICATE)"
    models_where="$models_where AND channel_id IN (SELECT id FROM model_channels WHERE $CHANNEL_PREDICATE)"
    tiers_where="$tiers_where AND channel_model_id IN (SELECT id FROM channel_models WHERE channel_id IN (SELECT id FROM model_channels WHERE $CHANNEL_PREDICATE))"
fi

echo "==> 渠道清单"
run_sql "SELECT id, name, public_alias, scope, enabled, base_url, api_format FROM model_channels WHERE $channels_where ORDER BY sort_order, name;" | tee "$OUT_DIR/channels.txt"

echo "==> 导出 model_channels（排除 api_key / secret_key / headers_json）"
copy_csv "$OUT_DIR/model_channels.csv" "COPY (SELECT id, user_id, scope, enabled, name, public_alias, sort_order, base_url, api_format, concurrency_limit, models_json, retired_models_json, created_at, updated_at FROM model_channels WHERE $channels_where ORDER BY sort_order, name) TO STDOUT WITH CSV HEADER;"

echo "==> 导出 channel_models"
copy_csv "$OUT_DIR/channel_models.csv" "COPY (SELECT id, channel_id, model_key, provider_model_key, display_name, sort_order, icon, capability, protocol, billing_mode, unit_price_microcredits, input_token_price_microcredits, output_token_price_microcredits, cached_token_price_microcredits, price_configured, enabled, price_version, capability_version, capability_config_json, created_at, updated_at FROM channel_models WHERE $models_where ORDER BY channel_id, sort_order, model_key) TO STDOUT WITH CSV HEADER;"

echo "==> 导出 channel_model_price_tiers"
copy_csv "$OUT_DIR/channel_model_price_tiers.csv" "COPY (SELECT id, channel_model_id, selector_key, selector_json, resolution, video_seconds, provider_model_key, billing_mode, unit_price_microcredits, input_token_price_microcredits, output_token_price_microcredits, cached_token_price_microcredits, price_configured, enabled, price_version, created_at, updated_at FROM channel_model_price_tiers WHERE $tiers_where ORDER BY channel_model_id, selector_key) TO STDOUT WITH CSV HEADER;"

echo "==> 导出合并报表（价格已换算成积分：microcredits ÷ 1000000）"
report_channel_filter=""
if [ -n "$CHANNEL_PREDICATE" ]; then
    report_channel_filter=" AND (${CHANNEL_PREDICATE})"
fi
copy_csv "$OUT_DIR/model_price_report.csv" "COPY (SELECT c.name AS channel, c.base_url, m.model_key, m.provider_model_key, m.capability, m.protocol, m.enabled, m.price_configured, round(m.unit_price_microcredits / 1000000.0, 4) AS price_credits, t.selector_key, round(t.unit_price_microcredits / 1000000.0, 4) AS tier_price_credits, t.enabled AS tier_enabled FROM channel_models m JOIN model_channels c ON c.id = m.channel_id LEFT JOIN channel_model_price_tiers t ON t.channel_model_id = m.id AND t.deleted_at IS NULL WHERE m.deleted_at IS NULL AND c.deleted_at IS NULL${report_channel_filter} ORDER BY c.name, m.sort_order, m.model_key, t.selector_key) TO STDOUT WITH CSV HEADER;"

echo "==> 密钥扫描"
if grep -rlE 'sk-[A-Za-z0-9_-]{16}|Bearer [A-Za-z0-9._-]{16}' "$OUT_DIR" >/dev/null 2>&1; then
    echo "⚠️  产物中疑似出现密钥字样，发给我之前请先检查并脱敏：" >&2
    grep -rlE 'sk-[A-Za-z0-9_-]{16}|Bearer [A-Za-z0-9._-]{16}' "$OUT_DIR" >&2
else
    echo "未发现密钥字样。"
fi

tar czf "$OUT_DIR.tgz" -C "$(dirname "$OUT_DIR")" "$(basename "$OUT_DIR")"

echo
echo "完成。产物："
ls -la "$OUT_DIR"
echo
echo "打包文件：$OUT_DIR.tgz"
echo "把它发我即可（不要发 .env）。"
