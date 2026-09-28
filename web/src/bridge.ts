import {
  App,
  type McpUiToolResultNotification,
} from "@modelcontextprotocol/ext-apps";

type TaskStatus = "queued" | "active" | "blocked" | "completed" | "skipped";

export interface TodojoTask {
  id: string;
  display_id: string;
  title: string;
  description?: string;
  order: number;
  status: TaskStatus;
  block_reason?: string;
  completed_at?: string;
  intervals: { started_at: string; ended_at?: string }[];
}

export interface TodojoPlan {
  plan_id: string;
  title?: string;
  as_of: string;
  work_ms: number;
  current_task_id?: string;
  version: number;
  status: "active" | "completed";
  tasks: TodojoTask[];
}

export type ToolResultListener = (result: unknown) => void;

export interface TodojoBridge {
  connect(): Promise<void>;
  getPlan(planId: string): Promise<TodojoPlan>;
  onToolResult(listener: ToolResultListener): () => void;
}

const taskStatuses = new Set<TaskStatus>([
  "queued",
  "active",
  "blocked",
  "completed",
  "skipped",
]);

/** Keep untrusted tool results out of HTML attributes and timer arithmetic. */
export function asPlan(value: unknown): TodojoPlan | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<TodojoPlan>;
  if (
    typeof candidate.plan_id !== "string" ||
    typeof candidate.as_of !== "string" ||
    !Number.isFinite(Date.parse(candidate.as_of)) ||
    !Number.isInteger(candidate.version) ||
    (candidate.version ?? -1) < 0 ||
    typeof candidate.work_ms !== "number" ||
    !Number.isFinite(candidate.work_ms) ||
    candidate.work_ms < 0 ||
    (candidate.status !== "active" && candidate.status !== "completed") ||
    (candidate.title !== undefined && typeof candidate.title !== "string") ||
    (candidate.current_task_id !== undefined &&
      typeof candidate.current_task_id !== "string") ||
    !Array.isArray(candidate.tasks)
  )
    return undefined;
  for (const task of candidate.tasks) {
    if (
      !task ||
      typeof task !== "object" ||
      typeof task.id !== "string" ||
      typeof task.display_id !== "string" ||
      typeof task.title !== "string" ||
      !Number.isInteger(task.order) ||
      !taskStatuses.has(task.status) ||
      (task.description !== undefined &&
        typeof task.description !== "string") ||
      (task.block_reason !== undefined &&
        typeof task.block_reason !== "string") ||
      (task.completed_at !== undefined &&
        typeof task.completed_at !== "string") ||
      !Array.isArray(task.intervals) ||
      !task.intervals.every(
        (interval) =>
          interval &&
          typeof interval.started_at === "string" &&
          Number.isFinite(Date.parse(interval.started_at)) &&
          (interval.ended_at === undefined ||
            (typeof interval.ended_at === "string" &&
              Number.isFinite(Date.parse(interval.ended_at)))),
      )
    )
      return undefined;
  }
  return candidate as TodojoPlan;
}

function planFromResult(result: unknown): TodojoPlan | undefined {
  const value = result as { structuredContent?: unknown } | undefined;
  return asPlan(value?.structuredContent);
}

/** Pinned MCP Apps v2 adapter. It deliberately receives the initial result before polling. */
export class McpAppsBridge implements TodojoBridge {
  private readonly app = new App(
    { name: "ToDoJo", version: "0.2.1" },
    { availableDisplayModes: ["inline"] },
  );
  private readonly listeners = new Set<ToolResultListener>();

  constructor() {
    this.app.addEventListener(
      "toolresult",
      (result: McpUiToolResultNotification["params"]) => {
        for (const listener of this.listeners) listener(result);
      },
    );
  }

  async connect(): Promise<void> {
    await this.app.connect();
  }

  async getPlan(planId: string): Promise<TodojoPlan> {
    const result = await this.app.callServerTool({
      name: "get_task_plan",
      arguments: { plan_id: planId },
    });
    const plan = planFromResult(result);
    if (!plan) throw new Error("ToDoJo server returned no task plan");
    return plan;
  }

  onToolResult(listener: ToolResultListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
