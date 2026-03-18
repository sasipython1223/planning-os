# Engineering Rules

## Command Spine & Mutations

- **Prefer Intent Over Raw CRUD**  
  As the model evolves, command design should move toward domain intent rather than low-level row or field operations. Existing lower-level commands may remain temporarily during migration.

- **Envelope Metadata Must Be Honest**  
  Command envelopes must include execution metadata appropriate to the current runtime stage. At minimum this includes a unique command ID, timestamp, and correlation ID. Additional provenance fields should be added only when they can be populated truthfully.

- **Transitional Paths Must Be Marked**  
  Any legacy mutation path bypassing the command spine must be explicitly marked with a `// Transitional path` comment and must not be expanded.

## Data & State

- **Separate Canonical from Derived**  
  Persist canonical inputs. Recompute derived schedule outputs on hydration wherever practical.

- **Worker Owns Persistence**  
  React must not directly manage canonical persistence.

- **No Hidden Mutation**  
  If a meaningful mutation cannot be traced, explained, or governed through the command spine, it is architectural debt and must not be expanded.

## Code Constraints

- **Strict Typing**  
  Domain and command contracts must be explicitly typed. Avoid `any` in core protocol and payload definitions.

- **Keep Core Mutation Flow Synchronous**  
  Worker-side canonical mutations should remain synchronous unless a real requirement forces otherwise. Deferred persistence may remain asynchronous.

- **Smallest Architecture-Safe Change**  
  Prefer incremental hardening over broad refactor. Preserve working behavior unless a milestone explicitly changes it.