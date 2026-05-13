import type { WorkMinutes } from "@planner/protocol";
import {
    ENGINE_ABI_VERSION_V2,
    type MinuteCalendarBoundary,
    type MinuteScheduleDependency,
    type MinuteScheduleRequest,
    type MinuteScheduleTask,
} from "@planner/protocol/kernel";
import { compileCalendar } from "../temporal/calendarCompiler.js";
import { createMinuteAnchor } from "../temporal/minuteAnchor.js";
import type { SchedulingStateSnapshot } from "./ISchedulingEngine.js";
import {
    toMinuteConstraintDate,
    toMinuteDuration,
    toMinuteLag,
    toMinuteMinEarlyStart,
} from "./minutePayloadPrimitives.js";

/**
 * D7a shadow-only adapter that prepares minute-based payload structures.
 *
 * This does NOT replace the production slot engine path yet.
 * It is a parallel, auditable preparation seam for the Minute-Slot transition.
 *
 * W5B-B1: task calendar IDs are now passed through on the temporal shadow
 * request so the temporal kernel can run per-task calendar behavior. The
 * slot path remains authoritative. Lag/resource calendars stay deferred.
 */
export class MinuteEngineAdapter {
  prepareRequest(state: SchedulingStateSnapshot): MinuteScheduleRequest {
    const summaryIds = new Set<string>();
    for (const t of state.tasks) {
      if (t.parentId) summaryIds.add(t.parentId);
    }

    // Project calendar remains the default/fallback for unassigned tasks and
    // lag calendar handling in W5B-B1.
    const projectCalendarId = state.projectCalendar.id as string;

    const tasks: MinuteScheduleTask[] = state.tasks.map((task) => {
      const constraintDateMinute = task.constraintDateMinutes != null
        ? toMinuteConstraintDate({
            projectStartDate: state.projectStartDate,
            constraintDateMinutes: task.constraintDateMinutes,
            constraintType: task.constraintType,
            projectCalendar: state.compiledProjectCalendar,
            nwdSet: state.nwdSet,
            fallbackMinutesPerDay: state.temporalAdapter.minutesPerDay as number,
          })
        : undefined;

      return {
        id: task.id,
        durationMinutes: toMinuteDuration(task.durationWorkMinutes),
        minEarlyStartMinutes: toMinuteMinEarlyStart(
          (task.minEarlyStartMinutes ?? (0 as WorkMinutes)) as WorkMinutes,
        ),
        parentId: task.parentId,
        isSummary: summaryIds.has(task.id),
        // W5B-B1: task calendar active on temporal shadow path only.
        // Missing assignment falls back to project calendar deterministically.
        calendarId: task.assignedCalendarId
          ? String(task.assignedCalendarId)
          : projectCalendarId,
        ...(task.constraintType !== undefined ? { constraintType: task.constraintType } : {}),
        ...(constraintDateMinute !== undefined ? { constraintDateMinute } : {}),
      };
    });

    const dependencies: MinuteScheduleDependency[] = state.dependencies.map((dep) => ({
      predId: dep.predId,
      succId: dep.succId,
      depType: dep.type,
      lagMinutes: toMinuteLag(dep.lagWorkMinutes),
      // W5B-B1 conservative scope: lag calendar parity is deferred.
      lagCalendarId: projectCalendarId,
    }));

    const anchor = createMinuteAnchor(state.projectStartDate);
    const calendarConfigs = {
      [projectCalendarId]: state.projectCalendar,
      ...state.calendars,
    };
    const calendars: MinuteCalendarBoundary[] = Object.entries(calendarConfigs).map(
      ([id, config]) => ({
        id,
        intervals: compileCalendar(config, anchor),
      }),
    );

    return {
      abiVersion: ENGINE_ABI_VERSION_V2,
      tasks,
      dependencies,
      calendars,
      projectCalendarId,
      dataDateMinute: 0,
    };
  }
}
