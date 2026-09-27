import type { TodojoPlan, TodojoTask } from "./bridge.js";

export function orderedTasks(plan: TodojoPlan): TodojoTask[] {
  return [...plan.tasks].sort((left, right) => left.order - right.order);
}

/** Latest authoritative completion, stable under later task reordering. */
export function lastCompletedTask(plan: TodojoPlan): TodojoTask | undefined {
  return orderedTasks(plan)
    .filter((task) => task.status === "completed")
    .sort((left, right) => {
      const leftTime = Date.parse(left.completed_at ?? "") || 0;
      const rightTime = Date.parse(right.completed_at ?? "") || 0;
      return (
        leftTime - rightTime ||
        left.order - right.order ||
        left.id.localeCompare(right.id)
      );
    })
    .at(-1);
}

/** Duration represented by a server snapshot; open intervals end at as_of. */
export function taskDurationMs(task: TodojoTask, asOfMs: number): number {
  return task.intervals.reduce((total, interval) => {
    const start = Date.parse(interval.started_at);
    const end = interval.ended_at ? Date.parse(interval.ended_at) : asOfMs;
    return (
      total +
      (Number.isFinite(start) && Number.isFinite(end)
        ? Math.max(0, end - start)
        : 0)
    );
  }, 0);
}
