import type {
  CreatePlanInput,
  NewTask,
  TaskPlan,
  TaskReference,
} from "./model.js";
import type { StatusCallback } from "./progress.js";

/** Persistence boundary so a hosted backend can replace SQLite without tool changes. */
export interface TaskPlanRepository {
  createPlan(input: CreatePlanInput, status?: StatusCallback): TaskPlan;
  getPlan(planId: string, status?: StatusCallback): TaskPlan;
  addTask(
    planId: string,
    task: NewTask,
    afterTaskId?: TaskReference,
    status?: StatusCallback,
  ): TaskPlan;
  startTask(
    planId: string,
    taskId: TaskReference,
    status?: StatusCallback,
  ): TaskPlan;
  completeTask(
    planId: string,
    taskId: TaskReference,
    status?: StatusCallback,
  ): TaskPlan;
  advanceTask(
    planId: string,
    completeTaskId: TaskReference,
    startTaskId: TaskReference,
    status?: StatusCallback,
  ): TaskPlan;
  blockTask(
    planId: string,
    taskId: TaskReference,
    reason: string,
    status?: StatusCallback,
  ): TaskPlan;
  skipTask(
    planId: string,
    taskId: TaskReference,
    reason?: string,
    status?: StatusCallback,
  ): TaskPlan;
  reorderTasks(
    planId: string,
    orderedTaskIds: TaskReference[],
    status?: StatusCallback,
  ): TaskPlan;
  close(): void;
}
