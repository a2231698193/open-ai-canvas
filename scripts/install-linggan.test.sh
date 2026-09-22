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
