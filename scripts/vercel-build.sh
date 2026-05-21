#!/usr/bin/env bash
set -euo pipefail

source "$HOME/.cargo/env"

pnpm -C packages/cpm-wasm build
pnpm -C apps/web build
