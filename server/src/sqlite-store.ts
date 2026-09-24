import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  type Clock,
  type CreatePlanInput,
  type NewTask,
  systemClock,
  type Task,
  type TaskInterval,
  type TaskPlan,
  type TaskReference,
  TodojoError,
} from "./model.js";
import { type StatusCallback, withProgress } from "./progress.js";
import type { TaskPlanRepository } from "./store.js";
import { taskDurationMs } from "./timers.js";

export interface SQLiteStoreOptions {
  /** Installed and tunnel runs require TODOJO_DB_PATH. Development must be explicit. */
  mode?: "installed" | "tunnel" | "development";
  dbPath?: string;
  clock?: Clock;
  busyTimeoutMs?: number;
}

type PlanRow = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  next_task_number: number;
  status: "active" | "completed";
  current_task_id: string | null;
};

type TaskRow = {
  id: string;
  display_id: string;
  title: string;
  description: string | null;
  task_order: number;
  status: Task["status"];
  block_reason: string | null;
  created_at: string;
  completed_at: string | null;
  skipped_at: string | null;
};

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const developmentDatabase = resolve(repositoryRoot, ".data", "todojo.sqlite");

/** Resolves only an absolute configured path, except for explicit repo-local development. */
export function resolveDatabasePath(options: SQLiteStoreOptions = {}): string {
  const mode =
    options.mode ??
    (process.env.TODOJO_DEV_MODE === "1" ? "development" : "installed");
  const configured = options.dbPath ?? process.env.TODOJO_DB_PATH;
  if (configured && isAbsolute(configured)) return configured;
  if (mode === "development" && !configured) return developmentDatabase;
  throw new TodojoError(
    "DATABASE_PATH_REQUIRED",
    "TODOJO_DB_PATH must be an absolute path outside explicit development mode",
  );
}

/** SQLite-backed repository. Every mutation, ID allocation, and snapshot is transactionally consistent. */
export class SQLiteTaskPlanRepository implements TaskPlanRepository {
  readonly dbPath: string;
  private readonly database: DatabaseSync;
  private readonly clock: Clock;
  private transactionDepth = 0;

  constructor(options: SQLiteStoreOptions = {}) {
    this.dbPath = resolveDatabasePath(options);
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.database = new DatabaseSync(this.dbPath);
    this.clock = options.clock ?? systemClock;
    this.database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;",
    );
    if (options.busyTimeoutMs !== undefined) {
      this.database.exec(
        `PRAGMA busy_timeout = ${Math.min(10_000, Math.max(0, Math.floor(options.busyTimeoutMs)))};`,
      );
    }
    this.migrate();
  }

  createPlan(input: CreatePlanInput, status?: StatusCallback): TaskPlan {
    return withProgress("create_task_plan", status, () =>
      this.mutate(() => {
        const now = this.now();
        const planId = randomUUID();
        this.database
          .prepare(
            "INSERT INTO plans (id, title, created_at, updated_at, version, next_task_number, status, current_task_id) VALUES (?, ?, ?, ?, 1, ?, 'active', NULL)",
          )
          .run(planId, input.title ?? null, now, now, input.tasks.length + 1);
        input.tasks.forEach((task, index) => {
          this.insertTask(planId, task, index + 1, index + 1, now);
        });
        if (input.start_first && input.tasks.length > 0) {
          const first = this.taskByReference(planId, "T1");
          this.activate(planId, first.id, now);
        }
        return this.snapshot(planId);
      }),
    );
  }

  getPlan(planId: string, status?: StatusCallback): TaskPlan {
    return withProgress("get_task_plan", status, () => this.snapshot(planId));
  }

  addTask(
    planId: string,
    task: NewTask,
    afterTaskId?: TaskReference,
    status?: StatusCallback,
  ): TaskPlan {
    return withProgress("add_task", status, () =>
      this.mutate(() => {
        const plan = this.plan(planId);
        let taskOrder = this.maxOrder(planId) + 1;
        if (afterTaskId) {
          taskOrder = this.taskByReference(planId, afterTaskId).task_order + 1;
          const shifted = this.database
            .prepare(
              "SELECT id, task_order FROM tasks WHERE plan_id = ? AND task_order >= ? ORDER BY task_order DESC",
            )
            .all(planId, taskOrder) as { id: string; task_order: number }[];
          for (const existing of shifted) {
            this.database
              .prepare("UPDATE tasks SET task_order = ? WHERE id = ?")
              .run(existing.task_order + 1, existing.id);
          }
        }
        const now = this.now();
        this.insertTask(planId, task, plan.next_task_number, taskOrder, now);
        this.database
          .prepare(
            "UPDATE plans SET next_task_number = ?, status = 'active', updated_at = ?, version = version + 1 WHERE id = ?",
          )
          .run(plan.next_task_number + 1, now, planId);
        return this.snapshot(planId);
      }),
    );
  }

  startTask(
    planId: string,
    taskId: TaskReference,
    status?: StatusCallback,
  ): TaskPlan {
    return withProgress("start_task", status, () =>
      this.mutate(() => {
        const task = this.taskByReference(planId, taskId);
        this.requireNoOtherActive(planId, task.id);
        if (task.status !== "queued" && task.status !== "blocked") {
          throw new TodojoError(
            "TASK_NOT_STARTABLE",
            "start_task requires queued or blocked work",
          );
        }
        const now = this.now();
        this.activate(planId, task.id, now);
        this.touch(planId, now, "active");
        return this.snapshot(planId);
      }),
    );
  }

  completeTask(
    planId: string,
    taskId: TaskReference,
    status?: StatusCallback,
  ): TaskPlan {
    return withProgress("complete_task", status, () =>
      this.mutate(() => {
        const task = this.taskByReference(planId, taskId);
        this.requireActiveSource(task);
        const now = this.now();
        this.closeInterval(task.id, now);
        this.database
          .prepare(
            "UPDATE tasks SET status = 'completed', completed_at = ?, block_reason = NULL WHERE id = ?",
          )
          .run(now, task.id);
        this.clearCurrentTask(planId, task.id);
        this.touch(
          planId,
          now,
          this.hasNonterminal(planId, task.id) ? "active" : "completed",
        );
        return this.snapshot(planId);
      }),
    );
  }

  advanceTask(
    planId: string,
    completeTaskId: TaskReference,
    startTaskId: TaskReference,
    status?: StatusCallback,
  ): TaskPlan {
    return withProgress("advance_task", status, () =>
      this.mutate(() => {
        const source = this.taskByReference(planId, completeTaskId);
        const target = this.taskByReference(planId, startTaskId);
        this.requireActiveSource(source);
        if (
          source.id === target.id ||
          (target.status !== "queued" && target.status !== "blocked")
        ) {
          throw new TodojoError(
            "TASK_NOT_STARTABLE",
            "advance_task target must be distinct queued or blocked work",
          );
        }
        const now = this.now();
        this.closeInterval(source.id, now);
        this.database
          .prepare(
            "UPDATE tasks SET status = 'completed', completed_at = ?, block_reason = NULL WHERE id = ?",
          )
          .run(now, source.id);
        this.activate(planId, target.id, now);
        this.touch(planId, now, "active");
        return this.snapshot(planId);
      }),
    );
  }

  blockTask(
    planId: string,
    taskId: TaskReference,
    reason: string,
    status?: StatusCallback,
  ): TaskPlan {
    return withProgress("block_task", status, () =>
      this.mutate(() => {
        if (!reason.trim())
          throw new TodojoError(
            "TASK_NOT_STARTABLE",
            "block_task requires a reason",
          );
        const task = this.taskByReference(planId, taskId);
        const now = this.now();
        if (task.status === "active") this.closeInterval(task.id, now);
        if (
          task.status !== "active" &&
          task.status !== "queued" &&
          task.status !== "blocked"
        ) {
          throw new TodojoError(
            "TASK_NOT_STARTABLE",
            "block_task requires nonterminal work",
          );
        }
        this.database
          .prepare(
            "UPDATE tasks SET status = 'blocked', block_reason = ? WHERE id = ?",
          )
          .run(reason.trim(), task.id);
        this.touch(planId, now, "active");
        return this.snapshot(planId);
      }),
    );
  }

  skipTask(
    planId: string,
    taskId: TaskReference,
    reason?: string,
    status?: StatusCallback,
  ): TaskPlan {
    return withProgress("skip_task", status, () =>
      this.mutate(() => {
        const task = this.taskByReference(planId, taskId);
        if (task.status === "completed" || task.status === "skipped") {
          throw new TodojoError(
            "TASK_NOT_STARTABLE",
            "skip_task requires nonterminal work",
          );
        }
        const now = this.now();
        if (task.status === "active") this.closeInterval(task.id, now);
        this.database
          .prepare(
            "UPDATE tasks SET status = 'skipped', skipped_at = ?, block_reason = ? WHERE id = ?",
          )
          .run(now, reason?.trim() || null, task.id);
        this.clearCurrentTask(planId, task.id);
        this.touch(
          planId,
          now,
          this.hasNonterminal(planId, task.id) ? "active" : "completed",
        );
        return this.snapshot(planId);
      }),
    );
  }

  reorderTasks(
    planId: string,
    orderedTaskIds: TaskReference[],
    status?: StatusCallback,
  ): TaskPlan {
    return withProgress("reorder_tasks", status, () =>
      this.mutate(() => {
        const tasks = this.taskRows(planId);
        const selected = orderedTaskIds.map((reference) =>
          this.taskByReference(planId, reference),
        );
        if (
          new Set(selected.map((task) => task.id)).size !== selected.length ||
          selected.length === 0
        ) {
          throw new TodojoError(
            "INVALID_REORDER",
            "reorder_tasks requires unique task references",
          );
        }
        const full = selected.length === tasks.length;
        if (
          full &&
          selected.some(
            (task) => !tasks.some((existing) => existing.id === task.id),
          )
        ) {
          throw new TodojoError(
            "INVALID_REORDER",
            "full reorder must name every task exactly once",
          );
        }
        if (!full && selected.some((task) => task.status !== "queued")) {
          throw new TodojoError(
            "INVALID_REORDER",
            "subset reorder may name queued tasks only",
          );
        }
        const slots = selected
          .map((task) => task.task_order)
          .sort((a, b) => a - b);
        // Offset prevents a UNIQUE(plan_id, task_order) collision while rotating occupied slots.
        const offset = this.maxOrder(planId) + tasks.length + 1;
        for (const task of selected)
          this.database
            .prepare(
              "UPDATE tasks SET task_order = task_order + ? WHERE id = ?",
            )
            .run(offset, task.id);
        selected.forEach((task, index) => {
          this.database
            .prepare("UPDATE tasks SET task_order = ? WHERE id = ?")
            .run(slots[index], task.id);
        });
        const now = this.now();
        this.touch(planId, now);
        return this.snapshot(planId);
      }),
    );
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY, title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        version INTEGER NOT NULL, next_task_number INTEGER NOT NULL, status TEXT NOT NULL,
        current_task_id TEXT
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id), display_id TEXT NOT NULL,
        title TEXT NOT NULL, description TEXT, task_order INTEGER NOT NULL, status TEXT NOT NULL,
        block_reason TEXT, created_at TEXT NOT NULL, completed_at TEXT, skipped_at TEXT,
        UNIQUE(plan_id, display_id), UNIQUE(plan_id, task_order)
      );
      CREATE TABLE IF NOT EXISTS intervals (
        id INTEGER PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), started_at TEXT NOT NULL, ended_at TEXT
      );
      CREATE INDEX IF NOT EXISTS task_plan_order ON tasks(plan_id, task_order);
      CREATE INDEX IF NOT EXISTS interval_task ON intervals(task_id, started_at);
    `);
    const columns = this.database.prepare("PRAGMA table_info(plans)").all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === "current_task_id")) {
      this.database.exec("ALTER TABLE plans ADD COLUMN current_task_id TEXT");
      this.database.exec(`
        UPDATE plans SET current_task_id = (
          SELECT tasks.id FROM tasks
          WHERE tasks.plan_id = plans.id AND tasks.status = 'active'
          ORDER BY tasks.task_order LIMIT 1
        )
      `);
    }
  }

  /** Read back connection-local journal and contention settings for runtime diagnostics. */
  storageSettings(): { journalMode: string; busyTimeoutMs: number } {
    const journal = this.database.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    const timeout = this.database.prepare("PRAGMA busy_timeout").get() as {
      timeout: number;
    };
    return {
      journalMode: journal.journal_mode,
      busyTimeoutMs: timeout.timeout,
    };
  }

  private mutate<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = work();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  private snapshot(planId: string): TaskPlan {
    const ownsTransaction = this.transactionDepth === 0;
    if (ownsTransaction) this.database.exec("BEGIN");
    try {
      const plan = this.plan(planId);
      const tasks = this.taskRows(planId).map((task) => this.toTask(task));
      const asOf = this.now();
      const snapshotClock: Clock = { now: () => new Date(asOf) };
      const workMs = tasks.reduce(
        (total, task) => total + taskDurationMs(task.intervals, snapshotClock),
        0,
      );
      if (ownsTransaction) this.database.exec("COMMIT");
      return {
        plan_id: plan.id,
        title: plan.title ?? undefined,
        created_at: plan.created_at,
        updated_at: plan.updated_at,
        as_of: asOf,
        work_ms: workMs,
        current_task_id: plan.current_task_id ?? undefined,
        version: plan.version,
        next_task_number: plan.next_task_number,
        status: plan.status,
        tasks,
      };
    } catch (error) {
      if (ownsTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private plan(planId: string): PlanRow {
    const row = this.database
      .prepare("SELECT * FROM plans WHERE id = ?")
      .get(planId) as PlanRow | undefined;
    if (!row)
      throw new TodojoError("PLAN_NOT_FOUND", `Plan ${planId} was not found`);
    return row;
  }

  private taskRows(planId: string): TaskRow[] {
    this.plan(planId);
    return this.database
      .prepare("SELECT * FROM tasks WHERE plan_id = ? ORDER BY task_order")
      .all(planId) as TaskRow[];
  }

  private taskByReference(planId: string, reference: TaskReference): TaskRow {
    const task = this.database
      .prepare(
        "SELECT * FROM tasks WHERE plan_id = ? AND (id = ? OR display_id = ?)",
      )
      .get(planId, reference, reference) as TaskRow | undefined;
    if (!task)
      throw new TodojoError(
        "TASK_NOT_FOUND",
        `Task ${reference} was not found in plan ${planId}`,
      );
    return task;
  }

  private toTask(row: TaskRow): Task {
    const intervals = (
      this.database
        .prepare(
          "SELECT started_at, ended_at FROM intervals WHERE task_id = ? ORDER BY id",
        )
        .all(row.id) as { started_at: string; ended_at: string | null }[]
    ).map(
      (interval): TaskInterval => ({
        started_at: interval.started_at,
        ended_at: interval.ended_at ?? undefined,
      }),
    );
    return {
      id: row.id,
      display_id: row.display_id,
      title: row.title,
      description: row.description ?? undefined,
      order: row.task_order,
      status: row.status,
      block_reason: row.block_reason ?? undefined,
      created_at: row.created_at,
      completed_at: row.completed_at ?? undefined,
      skipped_at: row.skipped_at ?? undefined,
      intervals,
    };
  }

  private insertTask(
    planId: string,
    task: NewTask,
    number: number,
    order: number,
    now: string,
  ): void {
    this.database
      .prepare(
        "INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, 'queued', NULL, ?, NULL, NULL)",
      )
      .run(
        randomUUID(),
        planId,
        `T${number}`,
        task.title,
        task.description ?? null,
        order,
        now,
      );
  }

  private activate(planId: string, taskId: string, now: string): void {
    this.database
      .prepare(
        "UPDATE tasks SET status = 'active', block_reason = NULL WHERE id = ?",
      )
      .run(taskId);
    this.database
      .prepare("INSERT INTO intervals (task_id, started_at) VALUES (?, ?)")
      .run(taskId, now);
    this.database
      .prepare("UPDATE plans SET current_task_id = ? WHERE id = ?")
      .run(taskId, planId);
  }

  private clearCurrentTask(planId: string, taskId: string): void {
    this.database
      .prepare(
        "UPDATE plans SET current_task_id = NULL WHERE id = ? AND current_task_id = ?",
      )
      .run(planId, taskId);
  }

  private closeInterval(taskId: string, now: string): void {
    const result = this.database
      .prepare(
        "UPDATE intervals SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL",
      )
      .run(now, taskId);
    if (result.changes !== 1)
      throw new TodojoError(
        "ACTIVE_SOURCE_REQUIRED",
        "active task has no open timing interval",
      );
  }

  private requireNoOtherActive(planId: string, intendedId: string): void {
    const active = this.database
      .prepare(
        "SELECT id FROM tasks WHERE plan_id = ? AND status = 'active' AND id != ?",
      )
      .get(planId, intendedId) as { id: string } | undefined;
    if (active)
      throw new TodojoError(
        "ACTIVE_TASK_EXISTS",
        "start_task rejected because another task is active",
      );
  }

  private requireActiveSource(task: TaskRow): void {
    if (task.status === "blocked")
      throw new TodojoError(
        "ACTIVE_SOURCE_REQUIRED",
        "blocked work must be resumed with start_task before complete_task or advance_task",
      );
    if (task.status !== "active")
      throw new TodojoError(
        "ACTIVE_SOURCE_REQUIRED",
        "complete_task and advance_task require an active source task",
      );
  }

  private hasNonterminal(planId: string, exceptId: string): boolean {
    return Boolean(
      this.database
        .prepare(
          "SELECT 1 FROM tasks WHERE plan_id = ? AND id != ? AND status IN ('queued', 'active', 'blocked') LIMIT 1",
        )
        .get(planId, exceptId),
    );
  }

  private maxOrder(planId: string): number {
    return (
      this.database
        .prepare(
          "SELECT COALESCE(MAX(task_order), 0) AS value FROM tasks WHERE plan_id = ?",
        )
        .get(planId) as { value: number }
    ).value;
  }

  private touch(
    planId: string,
    now: string,
    planStatus?: "active" | "completed",
  ): void {
    if (planStatus)
      this.database
        .prepare(
          "UPDATE plans SET updated_at = ?, version = version + 1, status = ? WHERE id = ?",
        )
        .run(now, planStatus, planId);
    else
      this.database
        .prepare(
          "UPDATE plans SET updated_at = ?, version = version + 1 WHERE id = ?",
        )
        .run(now, planId);
  }

  private now(): string {
    return this.clock.now().toISOString();
  }
}
