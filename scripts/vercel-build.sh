#!/usr/bin/env bash
set -euo pipefail

if [ -f "/rust/env" ]; then
  # shellcheck disable=SC1091
  source "/rust/env"
elif [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

pnpm -C packages/cpm-wasm build
pnpm -C apps/web build
