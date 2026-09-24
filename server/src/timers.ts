import type { Clock, TaskInterval } from "./model.js";

/** Returns persisted active work only; queued, blocked, and skipped time is excluded. */
function intervalDurationMs(interval: TaskInterval, clock: Clock): number {
  const end = interval.ended_at
    ? Date.parse(interval.ended_at)
    : clock.now().getTime();
  return Math.max(0, end - Date.parse(interval.started_at));
}

export function taskDurationMs(
  intervals: TaskInterval[],
  clock: Clock,
): number {
  return intervals.reduce(
    (total, interval) => total + intervalDurationMs(interval, clock),
    0,
  );
}
