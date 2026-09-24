import {
  asPlan,
  McpAppsBridge,
  type TodojoBridge,
  type TodojoPlan,
  type TodojoTask,
} from "./bridge.js";
import { compactModels } from "./compact-grid.js";
import { type CardModel, cardModels, taskDurationMs } from "./task-grid.js";

type Mode = "full" | "compact";
type Drawer =
  | { kind: "task"; task: TodojoTask }
  | { kind: "done" | "next" }
  | undefined;

const activePollMs = 2_000;
const completePollMs = 10_000;
const staleAfterMs = 6_000;

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function taskKind(task: TodojoTask | undefined): string {
  return task?.status ?? "empty";
}

/** Stateful presentation shell: all task facts are snapshots from the MCP server. */
export class TodojoWidget {
  private plan: TodojoPlan | undefined;
  private planId: string | undefined;
  private mode: Mode = "full";
  private drawer: Drawer;
  private phase: "loading" | "ready" | "stale" | "error" = "loading";
  private lastResponseAt = 0;
  private retryMs = activePollMs;
  private pollTimer: number | undefined;
  private tickTimer: number | undefined;
  private unlisten: (() => void) | undefined;
  private destroyed = false;
  private anchorPerfMs = 0;
  private snapshotMs = 0;
  private workBaselineMs = 0;
  private readonly taskBaselines = new Map<string, number>();

  constructor(
    private readonly root: HTMLElement,
    private readonly bridge: TodojoBridge,
  ) {}

  async start(): Promise<void> {
    this.unlisten = this.bridge.onToolResult((result) =>
      this.receive(
        asPlan((result as { structuredContent?: unknown })?.structuredContent),
      ),
    );
    window.addEventListener("online", this.wake);
    document.addEventListener("visibilitychange", this.wake);
    this.render();
    try {
      await this.bridge.connect();
    } catch {
      this.phase = "error";
      this.render();
    }
    this.tickTimer = window.setInterval(() => this.renderTimers(), 250);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pollTimer) window.clearTimeout(this.pollTimer);
    if (this.tickTimer) window.clearInterval(this.tickTimer);
    this.unlisten?.();
    window.removeEventListener("online", this.wake);
    document.removeEventListener("visibilitychange", this.wake);
  }

  private wake = (): void => {
    if (!document.hidden) void this.refresh(true);
  };

  private receive(candidate: TodojoPlan | undefined): void {
    if (!candidate || this.destroyed) return;
    if (!this.planId) this.planId = candidate.plan_id;
    if (candidate.plan_id !== this.planId) return;
    const previous = this.plan;
    if (previous) {
      if (candidate.version < previous.version) {
        this.schedule();
        return;
      }
      // A delayed response from an earlier poll cannot move an equal-version
      // snapshot backwards, even if a newer tool event arrived meanwhile.
      if (
        candidate.version === previous.version &&
        Date.parse(candidate.as_of) < Date.parse(previous.as_of)
      ) {
        this.schedule();
        return;
      }
    }
    const wasNew =
      !previous ||
      candidate.version > previous.version ||
      candidate.as_of !== previous.as_of;
    const priorWork = previous ? this.currentWorkMs() : 0;
    const priorTasks = new Map<string, number>();
    if (previous) {
      for (const task of previous.tasks) {
        if (task.status === "active")
          priorTasks.set(task.id, this.currentTaskMs(task));
      }
    }
    const priorPhase = this.phase;
    this.plan = candidate;
    this.lastResponseAt = performance.now();
    this.phase = "ready";
    this.retryMs = activePollMs;
    if (wasNew) this.reanchor(candidate, priorWork, priorTasks);
    if (wasNew || priorPhase !== "ready") this.render();
    else this.renderTimers();
    this.schedule();
  }

  private reanchor(
    plan: TodojoPlan,
    priorWork: number,
    priorTasks: Map<string, number>,
  ): void {
    const parsed = Date.parse(plan.as_of);
    this.snapshotMs = Number.isFinite(parsed) ? parsed : 0;
    this.anchorPerfMs = performance.now();
    const active = plan.tasks.some((task) => task.status === "active");
    this.workBaselineMs = active
      ? Math.max(plan.work_ms, priorWork)
      : plan.work_ms;
    this.taskBaselines.clear();
    for (const task of plan.tasks) {
      if (task.status !== "active") continue;
      this.taskBaselines.set(
        task.id,
        Math.max(
          taskDurationMs(task, this.snapshotMs),
          priorTasks.get(task.id) ?? 0,
        ),
      );
    }
  }

  private currentWorkMs(): number {
    if (!this.plan) return 0;
    if (!this.plan.tasks.some((task) => task.status === "active"))
      return this.plan.work_ms;
    return (
      this.workBaselineMs + Math.max(0, performance.now() - this.anchorPerfMs)
    );
  }

  private currentTaskMs(task: TodojoTask): number {
    const snapshot = taskDurationMs(task, this.snapshotMs);
    if (task.status !== "active") return snapshot;
    return (
      (this.taskBaselines.get(task.id) ?? snapshot) +
      Math.max(0, performance.now() - this.anchorPerfMs)
    );
  }

  private schedule(): void {
    if (this.destroyed || !this.planId) return;
    if (this.pollTimer) window.clearTimeout(this.pollTimer);
    const target =
      this.plan?.status === "completed" ? completePollMs : this.retryMs;
    this.pollTimer = window.setTimeout(() => void this.refresh(), target);
  }

  private async refresh(immediate = false): Promise<void> {
    if (!this.planId || this.destroyed) return;
    if (immediate && this.pollTimer) window.clearTimeout(this.pollTimer);
    try {
      const plan = await this.bridge.getPlan(this.planId);
      this.receive(plan);
    } catch {
      if (performance.now() - this.lastResponseAt > staleAfterMs)
        this.phase = "stale";
      this.retryMs = Math.min(this.retryMs * 2, 16_000);
      this.render();
      this.schedule();
    }
  }

  private renderTimers(): void {
    if (!this.plan) return;
    if (
      this.phase === "ready" &&
      performance.now() - this.lastResponseAt > staleAfterMs
    ) {
      this.phase = "stale";
      this.render();
    }
    const work = this.root.querySelector<HTMLElement>("[data-work-timer]");
    if (work) work.textContent = `WORK ${duration(this.currentWorkMs())}`;
    for (const node of this.root.querySelectorAll<HTMLElement>(
      "[data-task-id]",
    )) {
      const task = this.plan.tasks.find(
        (entry) => entry.id === node.dataset.taskId,
      );
      const timer = node.querySelector<HTMLElement>("[data-task-timer]");
      if (task && timer) timer.textContent = duration(this.currentTaskMs(task));
    }
    const drawerTimer = this.root.querySelector<HTMLElement>(
      "[data-drawer-timer]",
    );
    if (drawerTimer && this.drawer?.kind === "task") {
      const taskId = this.drawer.task.id;
      const task = this.plan.tasks.find((entry) => entry.id === taskId);
      if (task) drawerTimer.textContent = duration(this.currentTaskMs(task));
    }
  }

  private select(task: TodojoTask | undefined): void {
    if (!task) return;
    this.drawer =
      this.drawer?.kind === "task" && this.drawer.task.id === task.id
        ? undefined
        : { kind: "task", task };
    this.render();
    void this.refresh(true);
  }

  private taskCard(model: CardModel): string {
    const task = model.task;
    const status = taskKind(task);
    const selected =
      this.drawer?.kind === "task" && this.drawer.task.id === task?.id;
    const label = task
      ? `${model.role} ${task.display_id}, ${task.status}, ${task.title}`
      : `${model.role}, no task`;
    const activeDot =
      task?.status === "active"
        ? '<span class="todojo__dot" aria-hidden="true"></span>'
        : "";
    const reason =
      task?.status === "blocked" && task.block_reason
        ? `<span class="todojo__reason">${escapeHtml(task.block_reason)}</span>`
        : "";
    return `<button class="todojo__card todojo__card--${status}${selected ? " todojo__card--selected" : ""}" ${task ? `data-task-id="${escapeHtml(task.id)}"` : "disabled"} aria-label="${escapeHtml(label)}" aria-pressed="${selected}"><span class="todojo__meta">${activeDot}${model.role} ${task ? `· ${escapeHtml(task.display_id)}` : ""}<span class="todojo__timer" data-task-timer>${task ? duration(this.currentTaskMs(task)) : ""}</span></span><span class="todojo__task-title" data-title>${task ? escapeHtml(task.title) : "No task"}</span>${reason}</button>`;
  }

  private render(): void {
    const plan = this.plan;
    const completed =
      plan?.tasks.filter((task) => task.status === "completed").length ?? 0;
    const queued =
      plan?.tasks.filter((task) => task.status === "queued").length ?? 0;
    const status =
      this.phase === "ready"
        ? ""
        : this.phase === "loading"
          ? "Loading task plan…"
          : this.phase === "stale"
            ? "Waiting for a server update…"
            : "Unable to refresh task plan.";
    const content = !plan
      ? ""
      : this.mode === "full"
        ? this.fullGrid(plan)
        : this.compactGrid(plan);
    this.root.innerHTML = `<section class="todojo" aria-label="ToDoJo live task plan"><header class="todojo__header"><span class="todojo__brand">LIVE TASKS</span>${plan?.title ? `<span class="todojo__title">${escapeHtml(plan.title)}</span>` : ""}<span class="todojo__stat" data-work-timer>WORK ${duration(this.currentWorkMs())}</span>${this.mode === "full" ? `<button class="todojo__header-button" data-done>DONE ${completed}</button><button class="todojo__header-button" data-next>LATER ${queued}</button>` : ""}<button class="todojo__mode" data-mode>${this.mode === "full" ? "Compact" : "Full"}</button></header><div class="todojo__status" data-state="${this.phase}" aria-live="polite">${status}</div>${content}${this.drawerHtml(plan)}</section>`;
    this.root.querySelector("[data-mode]")?.addEventListener("click", () => {
      this.mode = this.mode === "full" ? "compact" : "full";
      this.render();
    });
    this.root.querySelector("[data-done]")?.addEventListener("click", () => {
      this.drawer = this.drawer?.kind === "done" ? undefined : { kind: "done" };
      this.render();
    });
    this.root.querySelector("[data-next]")?.addEventListener("click", () => {
      this.drawer = this.drawer?.kind === "next" ? undefined : { kind: "next" };
      this.render();
    });
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-task-id]")
      .forEach((button) => {
        button.addEventListener("click", () =>
          this.select(
            plan?.tasks.find((task) => task.id === button.dataset.taskId),
          ),
        );
      });
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-anchor]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const kind = button.dataset.anchor as "done" | "next";
          this.drawer = this.drawer?.kind === kind ? undefined : { kind };
          this.render();
        });
      });
    this.root.querySelector("[data-close]")?.addEventListener("click", () => {
      this.drawer = undefined;
      this.render();
    });
    this.fitTitles();
  }

  private fullGrid(plan: TodojoPlan): string {
    return `<div class="todojo__grid" data-view="full" aria-label="Full task grid">${cardModels(
      plan,
    )
      .map((model) => this.taskCard(model))
      .join("")}</div>`;
  }

  private compactGrid(plan: TodojoPlan): string {
    const models = compactModels(plan);
    return `<div class="todojo__compact" data-view="compact" aria-label="Compact task grid"><div class="todojo__compact-row"><button class="todojo__anchor" data-anchor="done" aria-label="Show task history, ${models.completed} completed tasks"><span class="todojo__anchor-label">DONE</span><span class="todojo__anchor-count">${models.completed}</span></button>${this.taskCard({ role: "LAST", task: models.last })}${this.taskCard({ role: "CURRENT", task: models.current })}</div><div class="todojo__compact-row"><button class="todojo__anchor" data-anchor="next" aria-label="Show ${models.queued} queued tasks"><span class="todojo__anchor-label">NEXT</span><span class="todojo__anchor-count">${models.queued}</span></button>${this.taskCard({ role: "NEXT", task: models.next[0] })}${this.taskCard({ role: "NEXT", task: models.next[1] })}</div></div>`;
  }

  private drawerHtml(plan: TodojoPlan | undefined): string {
    if (!this.drawer || !plan) return "";
    if (this.drawer.kind === "done" || this.drawer.kind === "next") {
      const history = this.drawer.kind === "done";
      const list = plan.tasks.filter((task) =>
        history
          ? task.status === "completed" || task.status === "skipped"
          : task.status === "queued",
      );
      const items = list
        .map((task) => {
          const label = `${escapeHtml(task.display_id)} · ${escapeHtml(task.title)}`;
          if (task.status === "skipped")
            return `<li class="todojo__history-skipped">${label} · Skipped · ${duration(this.currentTaskMs(task))}</li>`;
          if (task.status === "completed")
            return `<li>${label} · Completed · ${duration(this.currentTaskMs(task))}</li>`;
          return `<li>${label}</li>`;
        })
        .join("");
      return `<aside class="todojo__drawer" aria-label="${history ? "Task history" : "Upcoming queue"}"><div class="todojo__drawer-head"><strong class="todojo__drawer-title">${history ? "History" : "Upcoming"}</strong><button class="todojo__close" data-close aria-label="Close details">×</button></div><ul class="todojo__drawer-list">${items || "<li>None</li>"}</ul></aside>`;
    }
    const selected = this.drawer;
    if (selected.kind !== "task") return "";
    const task =
      plan.tasks.find((entry) => entry.id === selected.task.id) ??
      selected.task;
    const label =
      task.status === "blocked"
        ? `Active work before block: <span data-drawer-timer>${duration(this.currentTaskMs(task))}</span>`
        : task.status === "active"
          ? `Elapsed active time: <span data-drawer-timer>${duration(this.currentTaskMs(task))}</span>`
          : task.status === "completed"
            ? `Duration: <span data-drawer-timer>${duration(this.currentTaskMs(task))}</span>`
            : `Queue position: ${task.order}`;
    return `<aside class="todojo__drawer" aria-label="Task details"><div class="todojo__drawer-head"><strong class="todojo__drawer-title">${escapeHtml(task.display_id)} · ${escapeHtml(task.title)}</strong><button class="todojo__close" data-close aria-label="Close details">×</button></div><p class="todojo__drawer-copy">${task.status[0].toUpperCase()}${task.status.slice(1)}<br>${label}${task.block_reason ? `<br>${escapeHtml(task.block_reason)}` : ""}${task.description ? `<br><br>${escapeHtml(task.description)}` : ""}</p></aside>`;
  }

  private fitTitles(): void {
    for (const title of this.root.querySelectorAll<HTMLElement>(
      "[data-title]",
    )) {
      let size = 17;
      title.style.fontSize = `${size}px`;
      while (size > 13 && title.scrollHeight > title.clientHeight + 1) {
        size -= 0.5;
        title.style.fontSize = `${size}px`;
      }
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ] ?? character,
  );
}

const testBridge = (
  window as unknown as { __TODOJO_TEST_BRIDGE__?: TodojoBridge }
).__TODOJO_TEST_BRIDGE__;
const host = document.querySelector<HTMLElement>("#todojo");
if (host)
  void new TodojoWidget(host, testBridge ?? new McpAppsBridge()).start();
