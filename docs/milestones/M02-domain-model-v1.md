# Milestone: Domain Model v1 Contracts (M02)

## Objective
Establish the foundational TypeScript protocol contracts for the Parametric Domain Model and the Domain Compiler.

This milestone shifts the system’s conceptual anchor away from “editing Gantt activities” toward “defining project reality as structured data.” It defines how assumptions, zones, quantities, resources, and duration strategies are represented before being compiled into a schedule graph for the solver.

## In Scope
- Define `AssumptionSet` structure and versioning metadata
- Define physical domain primitives:
  - `Zone`
  - `Quantity`
  - `Resource`
- Define logic primitives:
  - `ProductivityRule`
  - `DurationStrategy`
- Define activity variants:
  - `AuthoredActivity` (human-authored planning intent)
  - `GeneratedActivity` (compiler-generated activity definition, pre-solver)
- Define `CompiledScheduleGraph` shape expected by the solver boundary
- Define `DomainCompiler` interface
- Add comprehensive TSDoc comments explaining ownership, intent, and future constraints

## Out of Scope
- React UI or visualization changes
- Actual compiler implementation logic
- Rust CPM solver changes
- FFI / WASM boundary changes
- Persistence or database schema migration
- Worker command dispatcher changes
- Scenario simulation logic
- AI / agent integration

## Files Expected
- `packages/protocol/domain.ts`
- `packages/protocol/compiler.ts`
- `packages/protocol/activities.ts` (new or updated if needed)

## Architecture Constraints
- **Project model is the source of truth**  
  Activities are projections or derivatives of domain objects and assumptions.

- **Kernel remains pure**  
  Domain concepts like `Zone`, `Resource`, and `ProductivityRule` must never be passed directly into the Rust solver. The compiler resolves them into solver-facing schedule graph primitives.

- **Narrative is structured**  
  No free-text fields may be used for anything that impacts schedule math. Text may exist for explanation only.

- **Strict typing is required**  
  Use discriminated unions where appropriate, especially for `DurationStrategy`. Prefer explicit readonly shapes to reduce accidental mutation.

- **No schedule calculation logic in protocol files**  
  These files define contracts only. They must not implement CPM logic, duration math, or scheduling behavior.

## Acceptance Criteria
- Protocol contracts compile with no type errors
- A clear type-level distinction exists between:
  - domain inputs
  - compiler-generated activity outputs
  - solver-facing schedule graph outputs
- `DomainCompiler` clearly accepts domain-model inputs and returns a `CompiledScheduleGraph`
- `DurationStrategy` is explicitly modeled as a discriminated union
- Manual override strategy requires structured justification metadata
- TSDoc comments warn future developers not to add schedule logic into these files
- Contracts are minimal but extensible for future versions

## Tests Required
- Type-level checks to ensure discriminated unions narrow correctly
- Mock instantiation tests for a simple realistic scenario, such as:
  - one zone
  - one quantity
  - one crew/resource
  - one productivity rule
  - one authored activity
  - one generated activity
  - one compiled schedule graph shape
- Tests should verify that the types can model the scenario cleanly without needing UI or solver code

## Implementation Notes for Copilot
- Make the smallest correct change
- Focus on contract quality, naming clarity, and future extensibility
- Do not invent runtime logic beyond what is necessary for testable mock instantiation
- Keep comments clear and institutional in tone
- Preserve compatibility with the existing protocol package structure