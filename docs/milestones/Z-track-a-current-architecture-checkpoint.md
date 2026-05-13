# Track-A Milestone Note — Current Architecture Checkpoint

## Status
Track-A has reached a valid intermediate milestone.

## What is genuinely implemented
- Canonical calendar state exists in Worker state
- Runtime compiled calendars exist via CalendarRegistry
- CalendarResolver exists for future assignment resolution
- WorkingTimeEngine exists and is tested
- Output-side rollup duration translation is project-calendar-aware
- Output-side diagnostics interpretation is project-calendar-aware
- Live authored constraint-date translation is project-calendar-aware under the project calendar

## What is NOT yet fully transitioned
- Duration -> kernel payload conversion is still scalar/day-slot based
- Lag -> kernel payload conversion is still scalar/day-slot based
- minEarlyStart -> kernel payload conversion is still scalar/day-slot based
- Some adapter behavior still depends on average minutesPerDay compatibility bridging
- Kernel request still behaves as a whole-day / nonWorkingDays style contract
- Task calendar semantics are not active
- Resource calendar semantics are not active

## Current architecture truth
The system currently supports a higher-fidelity single project-calendar model across:
- output interpretation
- rollup duration calculation
- diagnostics interpretation
- live constraint-date translation

The system does NOT yet support true multi-calendar execution semantics.

## Reason task/resource calendars remain inactive
Activating task/resource calendars now would mix:
- richer calendar semantics at Worker/output level
with
- scalar compatibility units in core payload math

That would create misleading or incorrect schedule behavior.

## Go / No-Go
- Project-calendar-aware output and constraint translation: GO
- Task-calendar activation: NO-GO
- Resource-calendar activation: NO-GO

## Next required milestone
Minute-Slot Payload Transition

## Meaning
The next major transition is to replace scalar day-slot payload assumptions for:
- duration
- lag
- minEarlyStart
with integer minute-based payload semantics at the Worker/kernel boundary, while keeping the kernel calendar-blind.

## Boundary rule
The kernel must remain:
- integer-only
- calendar-blind

But the boundary payload unit must evolve so that richer calendar semantics can be represented truthfully.

## Implementation caution
Do not expose task/resource calendar UI or runtime activation before the minute-slot payload transition is complete.
