/**
 * @module SlotCoordinateTranslator
 *
 * Phase D5 — Translates canonical WorkMinutes into slot kernel primitives.
 *
 * The slot kernel operates in day-slot units (1 = one working day).
 * This translator converts canonical WorkMinutes values to day-slots.
 * For authored constraint dates, when a compiled project calendar is
 * available, it snaps by real project-calendar working-day semantics.
 * Otherwise it falls back to the historical nonWorkingDays scalar path.
 *
 * The translator absorbs conversion logic that previously lived in
 * buildScheduleRequest (toDaySlots, snapConstraint) and
 * KernelTemporalAdapter.toDaySlots(). The worker never calls these
 * functions directly — only the SlotEngineAdapter creates and uses
 * this translator.
 *
 * D5/D6c: duration, lag, and min-early-start arithmetic remain scalar
 * because the slot kernel still accepts integer day-slots only. The
 * authored constraint-date seam is now calendar-aware under the project
 * calendar while keeping the kernel contract unchanged.
 * Constraint snapping policy is unchanged:
 *   SNET / MSO → snap forward to next working day
 *   FNLT / MFO → snap backward to previous working day
 *   ASAP / ALAP → no constraint date to snap
 */

import { MINUTES_PER_DAY, type ConstraintType, type WorkMinutes } from "@planner/protocol";
import { snapBackward, snapForward } from "../calendar.js";
import type { CompiledCalendar } from "../calendarRegistry.js";
import {
    daySlotToProjectInstant,
    projectDateToDaySlot,
    snapBackwardToWorkingDay,
    snapForwardToWorkingTime,
} from "../workingTimeEngine.js";
import type {
    IEngineCoordinateTranslator,
    InputTranslationContext,
} from "./IEngineCoordinateTranslator.js";

/** Start-oriented constraint types — snap forward on non-working day. */
const START_SNAP_TYPES: ReadonlySet<ConstraintType> = new Set(["SNET", "MSO"]);

/** Finish-oriented constraint types — snap backward on non-working day. */
const FINISH_SNAP_TYPES: ReadonlySet<ConstraintType> = new Set(["FNLT", "MFO"]);

/**
 * Slot kernel coordinate translator.
 *
 * Constructed per scheduling run by SlotEngineAdapter with the current
 * minutesPerDay and non-working-day set from the state snapshot.
 */
export class SlotCoordinateTranslator implements IEngineCoordinateTranslator {
  private readonly projectStartDate: string;
  private readonly minutesPerDay: number;
  private readonly nwdSet: ReadonlySet<number>;
  private readonly projectCalendar?: CompiledCalendar;

  constructor(context: InputTranslationContext) {
    this.projectStartDate = context.projectStartDate;
    this.minutesPerDay = context.minutesPerDay;
    this.nwdSet = context.nwdSet;
    this.projectCalendar = context.projectCalendar;
  }

  /** WorkMinutes → day-slots: Math.round(wm / minutesPerDay). */
  private toDaySlots(wm: WorkMinutes): number {
    return Math.round((wm as number) / this.minutesPerDay);
  }

  private toAuthoredDaySlot(wm: WorkMinutes): number {
    return Math.round((wm as number) / (MINUTES_PER_DAY as number));
  }

  private snapStartConstraint(daySlot: number): number {
    if (!this.projectCalendar) {
      return this.nwdSet.has(daySlot) ? snapForward(daySlot, this.nwdSet) : daySlot;
    }

    const authoredInstant = daySlotToProjectInstant(
      this.projectStartDate,
      daySlot,
      this.projectCalendar,
    );
    const snapped = snapForwardToWorkingTime(this.projectCalendar, authoredInstant);
    return snapped
      ? projectDateToDaySlot(this.projectStartDate, snapped.date)
      : daySlot;
  }

  private snapFinishConstraint(daySlot: number): number {
    if (!this.projectCalendar) {
      return this.nwdSet.has(daySlot) ? snapBackward(daySlot, this.nwdSet) : daySlot;
    }

    const authoredDate = daySlotToProjectInstant(
      this.projectStartDate,
      daySlot,
      this.projectCalendar,
    ).date;
    const snappedDate = snapBackwardToWorkingDay(this.projectCalendar, authoredDate);
    return snappedDate
      ? projectDateToDaySlot(this.projectStartDate, snappedDate)
      : daySlot;
  }

  convertDuration(wm: WorkMinutes): number {
    return this.toDaySlots(wm);
  }

  /**
   * Convert constraint date and snap to nearest working day if needed.
   *
   * Snapping policy (Phase B, unchanged):
   *   - SNET / MSO: advance to next working day if on NWD
   *   - FNLT / MFO: retreat to previous working day if on NWD
   *   - ASAP / ALAP / undefined: no snapping (no date constraint)
   */
  convertConstraintDate(
    wm: WorkMinutes,
    constraintType?: ConstraintType,
  ): number {
    const daySlot = this.projectCalendar
      ? this.toAuthoredDaySlot(wm)
      : this.toDaySlots(wm);
    if (!constraintType) return daySlot;
    if (START_SNAP_TYPES.has(constraintType)) return this.snapStartConstraint(daySlot);
    if (FINISH_SNAP_TYPES.has(constraintType)) return this.snapFinishConstraint(daySlot);
    return daySlot;
  }

  convertLag(wm: WorkMinutes): number {
    return this.toDaySlots(wm);
  }

  convertMinEarlyStart(wm: WorkMinutes): number {
    return this.toDaySlots(wm);
  }
}
