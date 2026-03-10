/**
 * @deprecated — This file is superseded by kernel.ts which has the full
 * Phase P contract (FS/SS/FF/SF + lag, late dates, float, calendar).
 * All consumers already import from "protocol/kernel".
 * This file is kept only to avoid breaking any stale references.
 */
export type {
  ScheduleDependency, ScheduleError, ScheduleRequest, ScheduleResponse, ScheduleTask, ScheduleTaskResult
} from "./kernel.js";

export { isScheduleError } from "./kernel.js";

