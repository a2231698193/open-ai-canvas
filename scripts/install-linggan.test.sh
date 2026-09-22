#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${ROOT}/install-linggan.sh"

uname() {
    if [[ "$1" == "-s" ]]; then
        printf '%s\n' "$FAKE_OS"
    else
        printf '%s\n' "$FAKE_ARCH"
    fi
}

expect_asset() {
    FAKE_OS="$1"
    FAKE_ARCH="$2"
    local actual
    actual="$(linggan_asset_name)"
    [[ "$actual" == "$3" ]] || {
        printf 'expected %s, got %s\n' "$3" "$actual" >&2
        exit 1
    }
}

expect_asset Darwin arm64 linggan-darwin-arm64.zip
expect_asset Darwin x86_64 linggan-darwin-amd64.zip
expect_asset Linux x86_64 linggan-linux-amd64.zip
expect_asset Linux aarch64 linggan-linux-arm64.zip
if FAKE_OS=Linux FAKE_ARCH=riscv64 linggan_asset_name >/dev/null 2>&1; then
    printf 'unsupported platform should fail\n' >&2
    exit 1
fi

printf 'install-linggan platform mapping: ok\n'

# 版本挑选：四段版本号会被 GitHub 判成预发布，/releases/latest 返回 404，
# 因此必须从列表里挑「最新且同时带目标压缩包和 SHA256SUMS」的那一个。
fixture="$(mktemp)"
trap 'rm -f "$fixture"' RETURN
cat >"$fixture" <<'JSON'
[
  {"tag_name": "v1.6.0", "draft": false, "prerelease": false,
   "assets": [{"name": "SHA256SUMS", "browser_download_url": "https://example/v1.6.0/SHA256SUMS"}]},
  {"tag_name": "v1.5.9", "draft": true, "prerelease": false,
   "assets": [{"name": "linggan-linux-amd64.zip", "browser_download_url": "https://example/v1.5.9/linux.zip"},
              {"name": "SHA256SUMS", "browser_download_url": "https://example/v1.5.9/SHA256SUMS"}]},
  {"tag_name": "v1.5.7.3", "draft": false, "prerelease": true,
   "assets": [{"name": "linggan-linux-amd64.zip", "browser_download_url": "https://example/v1.5.7.3/linux.zip"},
              {"name": "SHA256SUMS", "browser_download_url": "https://example/v1.5.7.3/SHA256SUMS"}]},
  {"tag_name": "v1.5.0", "draft": false, "prerelease": false,
   "assets": [{"name": "linggan-linux-amd64.zip", "browser_download_url": "https://example/v1.5.0/linux.zip"},
              {"name": "SHA256SUMS", "browser_download_url": "https://example/v1.5.0/SHA256SUMS"}]}
]
JSON

urls="$(linggan_release_urls linggan-linux-amd64.zip "$fixture")"
[[ "$(printf '%s\n' "$urls" | sed -n '1p')" == "https://example/v1.5.7.3/linux.zip" ]]
[[ "$(printf '%s\n' "$urls" | sed -n '2p')" == "https://example/v1.5.7.3/SHA256SUMS" ]]

if linggan_release_urls linggan-darwin-arm64.zip "$fixture" >/dev/null 2>&1; then
    printf 'expected a missing asset to fail\n' >&2
    exit 1
fi

printf 'install-linggan release selection: ok\n'
