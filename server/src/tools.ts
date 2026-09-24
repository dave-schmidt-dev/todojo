import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ProgressEvent, StatusCallback } from "./progress.js";
import { TODOJO_RESOURCE_URI } from "./resource.js";
import type { TaskPlanRepository } from "./store.js";

const taskSchema = z.object({
  id: z.string().uuid(),
  display_id: z.string().regex(/^T[1-9]\d*$/),
  title: z.string(),
  description: z.string().optional(),
  order: z.number().int().positive(),
  status: z.enum(["queued", "active", "blocked", "completed", "skipped"]),
  block_reason: z.string().optional(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  skipped_at: z.string().datetime().optional(),
  intervals: z.array(
    z.object({
      started_at: z.string().datetime(),
      ended_at: z.string().datetime().optional(),
    }),
  ),
});

const taskPlanSchema = z.object({
  plan_id: z.string().uuid(),
  title: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  as_of: z.string().datetime(),
  work_ms: z.number().int().nonnegative(),
  current_task_id: z.string().uuid().optional(),
  version: z.number().int().positive(),
  next_task_number: z.number().int().positive(),
  status: z.enum(["active", "completed"]),
  tasks: z.array(taskSchema),
});

const planId = z
  .string()
  .uuid()
  .describe("Explicit plan UUID from create_task_plan or list_task_plans.");
const taskReference = z
  .string()
  .min(1)
  .max(128)
  .describe("Task UUID or stable T-number within this plan.");
const modelOnly = { _meta: { ui: { visibility: ["model"] } } };
const modelAndApp = { _meta: { ui: { visibility: ["model", "app"] } } };

export interface ToolRegistrationOptions {
  onStatus?: StatusCallback;
}

function snapshot(plan: unknown) {
  const checked = taskPlanSchema.parse(plan);
  return {
    structuredContent: checked,
    content: [{ type: "text" as const, text: JSON.stringify(checked) }],
  };
}

/** Registers model-oriented task mutations and the single widget-rendering tool. */
export function registerTodojoTools(
  server: McpServer,
  repository: TaskPlanRepository,
  options: ToolRegistrationOptions = {},
): void {
  const status = options.onStatus;
  server.registerTool(
    "create_task_plan",
    {
      title: "Create ToDoJo task plan",
      description:
        "Use for substantial multi-step work. Do not create a plan for a small one-step task.",
      inputSchema: z.object({
        title: z.string().trim().min(1).max(160).optional(),
        tasks: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(500),
              description: z.string().trim().min(1).max(4_000).optional(),
            }),
          )
          .min(1)
          .max(100),
        start_first: z.boolean().optional(),
      }),
      outputSchema: taskPlanSchema,
      ...modelOnly,
    },
    (input) => snapshot(repository.createPlan(input, status)),
  );
  server.registerTool(
    "list_task_plans",
    {
      title: "List ToDoJo task plans",
      description:
        "Recover an explicit plan ID before reading, rendering, or mutating a persisted plan.",
      outputSchema: z.object({ plans: z.array(taskPlanSchema) }),
      annotations: { readOnlyHint: true },
      ...modelAndApp,
    },
    () => {
      const plans = repository
        .listPlans(status)
        .map((plan) => taskPlanSchema.parse(plan));
      return {
        structuredContent: { plans },
        content: [{ type: "text" as const, text: JSON.stringify({ plans }) }],
      };
    },
  );
  server.registerTool(
    "get_task_plan",
    {
      title: "Get ToDoJo task plan",
      description: "Read the authoritative snapshot for an explicit plan ID.",
      inputSchema: z.object({ plan_id: planId }),
      outputSchema: taskPlanSchema,
      annotations: { readOnlyHint: true },
      ...modelAndApp,
    },
    ({ plan_id }) => snapshot(repository.getPlan(plan_id, status)),
  );
  server.registerTool(
    "add_task",
    {
      title: "Add ToDoJo task",
      description:
        "Add a new task with a new permanent T-number to an existing plan.",
      inputSchema: z.object({
        plan_id: planId,
        title: z.string().trim().min(1).max(500),
        description: z.string().trim().min(1).max(4_000).optional(),
        after_task_id: taskReference.optional(),
      }),
      outputSchema: taskPlanSchema,
      ...modelOnly,
    },
    ({ plan_id, title, description, after_task_id }) =>
      snapshot(
        repository.addTask(
          plan_id,
          { title, description },
          after_task_id,
          status,
        ),
      ),
  );
  for (const [name, title, description, invoke] of [
    [
      "start_task",
      "Start ToDoJo task",
      "Start queued work or resume blocked work before completing or advancing it.",
      (input: { plan_id: string; task_id: string }) =>
        repository.startTask(input.plan_id, input.task_id, status),
    ],
    [
      "complete_task",
      "Complete ToDoJo task",
      "Complete only the active task. Resume blocked work with start_task before completion.",
      (input: { plan_id: string; task_id: string }) =>
        repository.completeTask(input.plan_id, input.task_id, status),
    ],
    [
      "advance_task",
      "Advance ToDoJo task",
      "Atomically complete the active task and start a distinct queued or blocked task; blocked work must be resumed before completion or advance.",
      (input: {
        plan_id: string;
        complete_task_id: string;
        start_task_id: string;
      }) =>
        repository.advanceTask(
          input.plan_id,
          input.complete_task_id,
          input.start_task_id,
          status,
        ),
    ],
  ] as const) {
    const inputSchema =
      name === "advance_task"
        ? z.object({
            plan_id: planId,
            complete_task_id: taskReference,
            start_task_id: taskReference,
          })
        : z.object({ plan_id: planId, task_id: taskReference });
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema,
        outputSchema: taskPlanSchema,
        ...modelOnly,
      },
      (input: unknown) => snapshot(invoke(input as never)),
    );
  }
  server.registerTool(
    "block_task",
    {
      title: "Block ToDoJo task",
      description:
        "Mark genuinely externally blocked work with a concise reason.",
      inputSchema: z.object({
        plan_id: planId,
        task_id: taskReference,
        reason: z.string().trim().min(1).max(500),
      }),
      outputSchema: taskPlanSchema,
      ...modelOnly,
    },
    ({ plan_id, task_id, reason }) =>
      snapshot(repository.blockTask(plan_id, task_id, reason, status)),
  );
  server.registerTool(
    "skip_task",
    {
      title: "Skip ToDoJo task",
      description:
        "Skip nonterminal work while preserving its permanent T-number.",
      inputSchema: z.object({
        plan_id: planId,
        task_id: taskReference,
        reason: z.string().trim().min(1).max(500).optional(),
      }),
      outputSchema: taskPlanSchema,
      ...modelOnly,
    },
    ({ plan_id, task_id, reason }) =>
      snapshot(repository.skipTask(plan_id, task_id, reason, status)),
  );
  server.registerTool(
    "reorder_tasks",
    {
      title: "Reorder ToDoJo tasks",
      description:
        "Reorder all task IDs, or only a queued subset. Full lists set all positions; queued subsets reorder only their existing slots. Display IDs never change.",
      inputSchema: z.object({
        plan_id: planId,
        ordered_task_ids: z.array(taskReference).min(1).max(100),
      }),
      outputSchema: taskPlanSchema,
      ...modelOnly,
    },
    ({ plan_id, ordered_task_ids }) =>
      snapshot(repository.reorderTasks(plan_id, ordered_task_ids, status)),
  );
  registerAppTool(
    server,
    "render_todojo",
    {
      title: "Render ToDoJo",
      description:
        "Render exactly one ToDoJo widget for the requested explicit plan ID. Never choose a plan from a multi-plan list.",
      inputSchema: z.object({ plan_id: planId }),
      outputSchema: taskPlanSchema,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: TODOJO_RESOURCE_URI } },
    },
    ({ plan_id }) => snapshot(repository.getPlan(plan_id, status)),
  );
}

export function statusText(event: ProgressEvent): string {
  return `todojo ${event.operation} ${event.phase}${event.error ? `: ${event.error}` : ""}`;
}
