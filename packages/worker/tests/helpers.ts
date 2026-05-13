import type { WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";

/** Convert whole days → WorkMinutes (days × 480). */
export const d = (days: number) => (days * MINUTES_PER_DAY) as WorkMinutes;

/** Convert hours → WorkMinutes (hours × 60). */
export const h = (hours: number) => (hours * 60) as WorkMinutes;

/** Identity cast — raw minutes → WorkMinutes. */
export const m = (minutes: number) => minutes as WorkMinutes;

/** Raw cast for fixture boundaries where the value is already minute-native. */
export const wm = (n: number) => n as WorkMinutes;
