# Planner-Studio / Planning OS — Copilot Instructions

## Architecture

Planner-Studio follows this architecture:

React UI → Web Worker authoritative state → Translator / Engine Adapter → WASM boundary → Rust CPM kernel.

## Non-Negotiable Rules

- React must not contain scheduling logic.
- Web Worker remains the authoritative state and orchestration layer.
- Translator / adapter layer handles conversion and projection.
- WASM boundary must remain explicit and testable.
- Rust CPM kernel remains deterministic.
- AI features are advisory/read-only unless explicitly approved.
- Do not change protocol contracts unless the issue explicitly approves it.
- Do not change CI/default scripts unless the issue explicitly approves it.
- Do not make broad refactors while implementing narrow issues.

## Implementation Style

- Make the smallest safe change.
- Prefer tests before production changes.
- Keep changes scoped to the issue.
- Use existing project patterns.
- Do not rename files or move folders unless explicitly requested.
- Report limitations honestly.

## Required Final Response

For every task, report:

- Files changed
- Commands run
- Test results
- What is proven
- What is not proven
- Risks
- Recommended next step
