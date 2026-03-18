# Architecture Boundaries

## System Layers

The system is strictly layered. Dependencies point downward. Upper layers may wrap lower layers, but lower layers must never depend on upper layers.

1. **Experience Layer (React UI / Agents)**  
   Pure rendering and intent capture. No scheduling math. No canonical state ownership.

2. **Intent & Commands**  
   Translation of user or system actions into standardized commands and execution envelopes.

3. **Governance & Validation (Worker Spine)**  
   The mutation choke point. Validates and governs command execution before canonical mutation.

4. **Audit / Execution Trace**  
   Captures command execution metadata and outcomes. This begins as a seam and may later evolve into a richer ledger.

5. **Domain Model (Worker State)**  
   Canonical planning truth, including assumptions, domain entities, authored planning inputs, and rules.

6. **Domain Compiler**  
   Translates the project model into a normalized schedule graph suitable for solver input.

7. **Schedule Graph**  
   Node/edge/constraint structure prepared for deterministic solving.

8. **Solver Kernel (Rust WASM)**  
   Pure deterministic scheduling math. No knowledge of UI, persistence, or rich domain concepts like zones or narrative.

9. **Projection Layer**  
   Maps solved outputs into dates, bars, histograms, reports, and other views.

## Hard Invariants

- **React is a Projection Layer**  
  UI components dispatch intent and render subscribed state. They do not own business logic or scheduling truth.

- **Worker Owns Canonical State**  
  The Web Worker remains the single owner of mutable planning truth.

- **Kernel is Pure**  
  The Rust kernel performs isolated math only.

- **New Mutations Must Go Through the Command Spine**  
  All new canonical mutation paths must route through `dispatchCommand()`. Temporary exceptions must be explicitly marked as transitional and must not be expanded.