---
name: Planner-Studio Milestone Task
about: Controlled AI-assisted milestone for Planner-Studio / Planning OS
title: "[MILESTONE] "
labels: milestone, needs-architecture-review
---

# Milestone

## Objective

## Background / Current Accepted State

## Architecture Rules
- React UI must not contain scheduling logic.
- Web Worker remains the authoritative state/orchestration layer.
- Translator / Engine Adapter handles conversion.
- WASM boundary must remain explicit.
- Rust CPM kernel remains deterministic.
- AI features remain advisory/read-only unless explicitly approved.

## Proposed Nature
Example:
- Test-only
- Documentation-only
- UI-only
- Worker-only
- Protocol change
- WASM boundary investigation

## Scope

## Out of Scope

## Allowed Files

## Forbidden Files

## Required Tests

## Required Documentation

## Validation Commands

## Stop Conditions
Stop immediately and report if:
- Production translator edit appears necessary.
- ProjectionAdapter edit appears necessary.
- Rust kernel edit appears necessary.
- WASM FFI edit appears necessary.
- Protocol contract change appears necessary.
- Global test config edit appears necessary.
- CI wiring appears necessary.
- Fixture usage appears necessary but was not approved.
- Exact parity cannot be proven without production changes.

## Required Final Report
Final report must include:
- Files added
- Files modified
- Commands run
- Test results
- What is proven
- What is not proven
- Safety confirmation
- Recommended next milestone

## Architecture Review
- [ ] ChatGPT architecture review completed
- [ ] Gemini independent review completed
- [ ] Human approval given before Copilot implementation

## Implementation Approval
- [ ] Approved for Copilot
