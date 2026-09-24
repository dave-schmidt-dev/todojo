import type { TodojoPlan, TodojoTask } from "./bridge.js";
import { lastCompletedTask, orderedTasks } from "./task-grid.js";

export interface CompactModels {
  last?: TodojoTask;
  current?: TodojoTask;
  next: [TodojoTask | undefined, TodojoTask | undefined];
  completed: number;
  queued: number;
}

export function compactModels(plan: TodojoPlan): CompactModels {
  const tasks = orderedTasks(plan);
  const current =
    tasks.find((task) => task.id === plan.current_task_id) ??
    tasks.find((task) => task.status === "active" || task.status === "blocked");
  const queued = tasks.filter((task) => task.status === "queued");
  return {
    last: lastCompletedTask(plan),
    current,
    next: [queued[0], queued[1]],
    completed: tasks.filter((task) => task.status === "completed").length,
    queued: queued.length,
  };
}
