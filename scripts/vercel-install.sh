#!/usr/bin/env bash
set -euo pipefail

corepack enable
corepack prepare pnpm@9.15.9 --activate

# Vercel's build image may already provide Rust under /rust instead of $HOME/.cargo.
# Prefer the existing environment when available; otherwise install a minimal rustup toolchain.
if [ -f "/rust/env" ]; then
  # shellcheck disable=SC1091
  source "/rust/env"
elif [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
else
  curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

rustup target add wasm32-unknown-unknown

if ! command -v wasm-pack >/dev/null 2>&1; then
  cargo install wasm-pack --locked
fi

pnpm install --frozen-lockfile
