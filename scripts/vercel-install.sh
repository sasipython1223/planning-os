#!/usr/bin/env bash
set -euo pipefail

corepack enable
corepack prepare pnpm@9.15.9 --activate

curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --target wasm32-unknown-unknown
source "$HOME/.cargo/env"

cargo install wasm-pack --locked

pnpm install --frozen-lockfile
