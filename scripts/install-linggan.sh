#!/usr/bin/env bash
# 从 GitHub Release 安装 linggan。只覆盖 ~/.linggan/bin/linggan，不读取或删除登录会话。

set -euo pipefail

REPO="${LINGGAN_GITHUB_REPO:-a2231698193/open-ai-canvas}"
INSTALL_DIR="${LINGGAN_INSTALL_DIR:-${HOME}/.linggan/bin}"
MARKER="# linggan-cli-path"

fail() {
    printf '安装失败：%s\n' "$1" >&2
    exit 1
}

linggan_asset_name() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"
    case "${os}:${arch}" in
        Darwin:arm64) printf 'linggan-darwin-arm64.zip' ;;
        Darwin:x86_64) printf 'linggan-darwin-amd64.zip' ;;
        Linux:x86_64) printf 'linggan-linux-amd64.zip' ;;
        Linux:aarch64) printf 'linggan-linux-arm64.zip' ;;
        *) return 1 ;;
    esac
}

profile_file() {
    case "${SHELL:-}" in
        */zsh) printf '%s\n' "${HOME}/.zshrc" ;;
        */bash) printf '%s\n' "${HOME}/.bashrc" ;;
        *) return 1 ;;
    esac
}

ensure_path() {
    local profile line
    profile="$(profile_file)" || {
        printf '请把下面一行加入当前 shell 的启动文件：\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >&2
        return 0
    }
    line="export PATH=\"${INSTALL_DIR}:\$PATH\" ${MARKER}"
    if [[ -f "$profile" ]] && grep -F "$MARKER" "$profile" >/dev/null; then
        return 0
    fi
    touch "$profile"
    printf '\n%s\n' "$line" >>"$profile"
    printf '已写入 %s。新开一个终端，或执行 source %s 后生效。\n' "$profile" "$profile" >&2
}

download() {
    local url="$1" destination="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL ${GITHUB_TOKEN:+-H "Authorization: Bearer ${GITHUB_TOKEN}"} -H "Accept: application/vnd.github+json" -o "$destination" "$url"
        return
    fi
    command -v wget >/dev/null 2>&1 || fail "需要 curl 或 wget"
    wget -q -O "$destination" ${GITHUB_TOKEN:+--header="Authorization: Bearer ${GITHUB_TOKEN}"} --header="Accept: application/vnd.github+json" "$url"
}

verify_sha256() {
    local file="$1" expected="$2" actual
    if command -v sha256sum >/dev/null 2>&1; then
        actual="$(sha256sum "$file" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
        actual="$(shasum -a 256 "$file" | awk '{print $1}')"
    else
        fail "需要 sha256sum 或 shasum"
    fi
    [[ "$actual" == "$expected" ]] || fail "SHA256 不一致：${file}"
}

# 从 Release 列表里挑出最新的、同时带目标平台压缩包和 SHA256SUMS 的那一个。
#
# 不读 /releases/latest：四段版本号会被 GitHub 判成预发布，latest 因此返回 404，
# 而这正是本仓库当前唯一的发布形态。列表接口默认包含预发布，按创建时间倒序。
# 输出两行：压缩包地址、校验和地址。
linggan_release_urls() {
    local asset="$1" releases_json="$2"
    python3 - "$asset" "$releases_json" <<'PY'
import json, sys
asset, path = sys.argv[1], sys.argv[2]
for release in json.load(open(path)):
    if release.get("draft"):
        continue
    assets = {item.get("name"): item.get("browser_download_url") for item in release.get("assets", [])}
    if asset in assets and "SHA256SUMS" in assets:
        print(assets[asset])
        print(assets["SHA256SUMS"])
        raise SystemExit
raise SystemExit(1)
PY
}

install_linggan() {
    local asset archive_url checksum_url checksums expected work archive urls
    asset="$(linggan_asset_name)" || fail "当前系统没有对应安装包：$(uname -s) $(uname -m)"
    command -v unzip >/dev/null 2>&1 || fail "需要 unzip"
    command -v python3 >/dev/null 2>&1 || fail "需要 python3"
    work="$(mktemp -d)"
    archive="${work}/${asset}"
    download "https://api.github.com/repos/${REPO}/releases?per_page=30" "${work}/releases.json"
    urls="$(linggan_release_urls "$asset" "${work}/releases.json")" || fail "没有任何 Release 同时提供 ${asset} 和 SHA256SUMS"
    archive_url="$(printf '%s\n' "$urls" | sed -n '1p')"
    checksum_url="$(printf '%s\n' "$urls" | sed -n '2p')"
    [[ -n "$archive_url" && -n "$checksum_url" ]] || fail "Release 资产地址不完整"
    download "$archive_url" "$archive"
    download "$checksum_url" "${work}/SHA256SUMS"
    expected="$(awk -v name="$asset" '$2 == name { print $1 }' "${work}/SHA256SUMS")"
    [[ -n "$expected" ]] || fail "SHA256SUMS 中没有 ${asset}"
    verify_sha256 "$archive" "$expected"
    unzip -q "$archive" -d "${work}/extracted"
    [[ -f "${work}/extracted/linggan" ]] || fail "压缩包里没有 linggan"
    install -d "$INSTALL_DIR"
    install -m 0755 "${work}/extracted/linggan" "${INSTALL_DIR}/linggan"
    ensure_path
    printf '已安装 %s\n' "${INSTALL_DIR}/linggan"
}

# 管道执行（文档里的 curl … | bash）时 bash 从标准输入读脚本，BASH_SOURCE 未定义，
# 直接展开会被 set -u 打死；回落到 $0 才能既跑管道又不在 source 时自动安装。
if [[ "${BASH_SOURCE[0]:-$0}" == "$0" ]]; then
    install_linggan
fi
