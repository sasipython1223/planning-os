import { MINUTES_PER_DAY, type ConstraintType, type WorkMinutes } from "@planner/protocol";
import { snapBackward, snapForward } from "../calendar.js";
import type { CompiledCalendar } from "../calendarRegistry.js";
import { createMinuteAnchor, dateToMinute, dayOffsetToMinute } from "../temporal/minuteAnchor.js";
import {
    daySlotToProjectInstant,
    getWorkingDayDefinition,
    snapBackwardToWorkingDay,
    snapForwardToWorkingTime,
} from "../workingTimeEngine.js";

const I32_MIN = -2_147_483_648;
const I32_MAX = 2_147_483_647;
const U32_MAX = 4_294_967_295;
const I64_MIN = -(2n ** 63n);
const I64_MAX = (2n ** 63n) - 1n;

function assertInteger(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} must be a finite integer. Received: ${value}`);
  }
}

/**
 * Guard a number for i64 boundary safety at the JS/TS edge.
 *
 * JS cannot represent every i64 value exactly, so we enforce both:
 * - Number safe integer
 * - signed i64 range
 */
export function assertI64SafeInteger(value: number, label: string): number {
  assertInteger(value, label);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer for JS transport. Received: ${value}`);
  }
  const asBigInt = BigInt(value);
  if (asBigInt < I64_MIN || asBigInt > I64_MAX) {
    throw new Error(`${label} overflows signed i64. Received: ${value}`);
  }
  return value;
}

/** Validate compatibility-bridge fit for current slot-kernel signed 32-bit fields. */
export function assertFitsI32(value: number, label: string): number {
  assertInteger(value, label);
  if (value < I32_MIN || value > I32_MAX) {
    throw new Error(`${label} overflows signed i32. Received: ${value}`);
  }
  return value;
}

/** Validate compatibility-bridge fit for current slot-kernel unsigned 32-bit fields. */
export function assertFitsU32(value: number, label: string): number {
  assertInteger(value, label);
  if (value < 0 || value > U32_MAX) {
    throw new Error(`${label} overflows unsigned u32. Received: ${value}`);
  }
  return value;
}

/** Canonical duration already stores working minutes, so minute payload is identity + i64 guard. */
export function toMinuteDuration(workMinutes: WorkMinutes): number {
  return assertI64SafeInteger(workMinutes as number, "durationMinutes");
}

/**
 * Canonical lag already stores signed working minutes.
 * TODO(D7a): confirm lag calendar ownership policy before task/resource calendars activate.
 */
export function toMinuteLag(workMinutes: WorkMinutes): number {
  return assertI64SafeInteger(workMinutes as number, "lagMinutes");
}

/** Canonical minimum early start already stores working minutes. */
export function toMinuteMinEarlyStart(workMinutes: WorkMinutes): number {
  return assertI64SafeInteger(workMinutes as number, "minEarlyStartMinutes");
}

export type ConstraintMinuteContext = {
  readonly projectStartDate: string;
  readonly constraintDateMinutes: WorkMinutes;
  readonly constraintType?: ConstraintType;
  readonly projectCalendar?: CompiledCalendar;
  readonly nwdSet?: ReadonlySet<number>;
  readonly fallbackMinutesPerDay?: number;
};

function isStartConstraint(type?: ConstraintType): boolean {
  return type === "SNET" || type === "MSO";
}

function isFinishConstraint(type?: ConstraintType): boolean {
  return type === "FNLT" || type === "MFO";
}

/**
 * Convert canonical authored day-offset date constraints into minute payload coordinates.
 *
 * - Calendar-aware path: project calendar + WorkingTimeEngine decide snapped day/instant.
 * - Fallback path: preserve existing scalar non-working-day snapping and map day→minute.
 */
export function toMinuteConstraintDate(context: ConstraintMinuteContext): number {
  const anchor = createMinuteAnchor(context.projectStartDate);

  if (context.projectCalendar) {
    const authoredDaySlot = Math.round((context.constraintDateMinutes as number) / (MINUTES_PER_DAY as number));
    if (isStartConstraint(context.constraintType)) {
      const authoredInstant = daySlotToProjectInstant(
        context.projectStartDate,
        authoredDaySlot,
        context.projectCalendar,
      );
      const snapped = snapForwardToWorkingTime(context.projectCalendar, authoredInstant);
      const effective = snapped ?? authoredInstant;
      const minute = dateToMinute(effective.date, anchor) + effective.minuteOfDay;
      return assertI64SafeInteger(minute, "constraintDateMinute");
    }

    if (isFinishConstraint(context.constraintType)) {
      const authoredDate = daySlotToProjectInstant(
        context.projectStartDate,
        authoredDaySlot,
        context.projectCalendar,
      ).date;
      const snappedDate = snapBackwardToWorkingDay(context.projectCalendar, authoredDate) ?? authoredDate;
      const dayDef = getWorkingDayDefinition(context.projectCalendar, snappedDate);
      const endMinute = dayDef.isWorking
        ? dayDef.intervals[dayDef.intervals.length - 1].endMinute
        : 0;
      const minute = dateToMinute(snappedDate, anchor) + endMinute;
      return assertI64SafeInteger(minute, "constraintDateMinute");
    }

    const authoredDate = daySlotToProjectInstant(
      context.projectStartDate,
      authoredDaySlot,
      context.projectCalendar,
    ).date;
    return assertI64SafeInteger(dateToMinute(authoredDate, anchor), "constraintDateMinute");
  }

  const minutesPerDay = context.fallbackMinutesPerDay ?? (MINUTES_PER_DAY as number);
  const daySlot = Math.round((context.constraintDateMinutes as number) / minutesPerDay);
  let snappedDay = daySlot;

  if (context.nwdSet) {
    if (isStartConstraint(context.constraintType) && context.nwdSet.has(daySlot)) {
      snappedDay = snapForward(daySlot, context.nwdSet);
    } else if (isFinishConstraint(context.constraintType) && context.nwdSet.has(daySlot)) {
      snappedDay = snapBackward(daySlot, context.nwdSet);
    }
  }

  return assertI64SafeInteger(dayOffsetToMinute(snappedDay), "constraintDateMinute");
}
