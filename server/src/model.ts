/** Authoritative, persisted ToDoJo domain values. */
type PlanStatus = "active" | "completed";
type TaskStatus = "queued" | "active" | "blocked" | "completed" | "skipped";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface TaskInterval {
  started_at: string;
  ended_at?: string;
}

export interface Task {
  id: string;
  display_id: string;
  title: string;
  description?: string;
  order: number;
  status: TaskStatus;
  block_reason?: string;
  created_at: string;
  completed_at?: string;
  skipped_at?: string;
  intervals: TaskInterval[];
}

export interface TaskPlan {
  plan_id: string;
  title?: string;
  created_at: string;
  updated_at: string;
  /** Server timestamp used to anchor every displayed duration in this snapshot. */
  as_of: string;
  /** Total active interval time across the plan at as_of. */
  work_ms: number;
  /** Internal UUID of the current task, including while it is blocked. */
  current_task_id?: string;
  version: number;
  next_task_number: number;
  status: PlanStatus;
  tasks: Task[];
}

export interface NewTask {
  title: string;
  description?: string;
}

export interface CreatePlanInput {
  title?: string;
  tasks: NewTask[];
  start_first?: boolean;
}

/** A UUID or a model-facing T-number, resolved only within its plan. */
export type TaskReference = string;

export class TodojoError extends Error {
  constructor(
    readonly code:
      | "PLAN_NOT_FOUND"
      | "DATABASE_PATH_REQUIRED"
      | "TASK_NOT_FOUND"
      | "ACTIVE_TASK_EXISTS"
      | "ACTIVE_SOURCE_REQUIRED"
      | "TASK_NOT_STARTABLE"
      | "INVALID_REORDER",
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}
