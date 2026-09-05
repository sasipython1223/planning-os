# Planning OS (Planner-Studio)

Planning OS is a **deterministic project scheduling and control platform**. It
computes project schedules with a Critical Path Method (CPM) kernel and keeps a
single authoritative project state that the UI renders.

It is **not an autonomous AI scheduler**. Any AI involvement is advisory and
read-only unless a change is explicitly approved by a human through the
governance process recorded in this repository.

## Architecture

```
React UI
  → Web Worker (authoritative state)
    → Translator / Engine Adapter
      → WASM boundary
        → Rust CPM kernel
```

- **React UI** (`apps/web`) — rendering and interaction only; contains no
  scheduling logic.
- **Web Worker** (`packages/worker`) — owns the authoritative project state,
  command handling, persistence, and import (XER / MSP) pipelines.
- **Protocol** (`packages/protocol`) — the typed contracts between UI, worker,
  and engine. Changes to these contracts are controlled.
- **WASM boundary** (`packages/cpm-wasm`) — thin wasm-bindgen wrapper exposing
  the kernel to JS. Built with `wasm-pack`; the generated `pkg/` directory is
  gitignored and must be built locally.
- **Rust CPM kernel** (`packages/cpm-kernel`) — deterministic CPM scheduling
  engine (forward/backward pass, calendars, constraints, floats).

See `docs/architecture.md`, `docs/ARCHITECTURE_BOUNDARIES.md`, and
`docs/PRODUCT_CONSTITUTION.md` for the governing documents.

## Source of truth

- Repository: [`sasipython1223/planning-os`](https://github.com/sasipython1223/planning-os)
- GitHub issues, pull requests, and the documents under `docs/` are the control
  record for lifecycle and gate decisions.

## Current lifecycle authority

- **Stage 2 reconciliation audit: ACCEPTED.**
- **Stage 3 is NOT yet authorised.** Stage 3 work may not begin until the
  hygiene entry conditions are completed and a gate decision is recorded in the
  control record.

## Development setup

Prerequisites:

- Node.js 22+ and [pnpm](https://pnpm.io) 10+
- Rust (stable) with the `wasm32-unknown-unknown` target:
  `rustup target add wasm32-unknown-unknown`
- [`wasm-pack`](https://github.com/drager/wasm-pack): `cargo install wasm-pack`

Install and build:

```sh
pnpm install
pnpm --filter cpm-wasm build   # generates packages/cpm-wasm/pkg (gitignored)
```

Run the web app:

```sh
pnpm --filter web dev
```

## Running tests (exact one-shot commands)

Do **not** use `pnpm -r test`: the worker package's `test` script is plain
`vitest`, which enters watch mode and never exits. Use these one-shot commands
(they are the same ones CI runs, see `.github/workflows/ci.yml`):

```sh
# JS/TS
pnpm --filter protocol test
pnpm --filter web test
pnpm --filter worker exec vitest run

# Rust
cargo test --manifest-path packages/cpm-kernel/Cargo.toml

# Rust → WASM
cd packages/cpm-wasm && wasm-pack test --node
```

## Governance principles

- The **Web Worker is authoritative** for project state; the UI never owns it.
- The **Rust kernel is deterministic**; identical inputs produce identical
  schedules.
- **React contains no scheduling logic.**
- **Protocol/schema changes are controlled** and must not be made casually.
- **Human approval is required** for lifecycle and gate decisions; AI output is
  advisory only.

## Known hygiene notes

- The unrelated **Car Finder** feature has been removed from this repository
  (it lives on in git history only).
- `docs/cpm-kernel-contract.md` is **stale** and needs a separate, explicitly
  scoped rewrite; do not treat it as current until that happens.
