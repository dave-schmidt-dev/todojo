import {
  asPlan,
  type DisplayProbeState,
  McpAppsBridge,
  type TodojoBridge,
  type TodojoPlan,
  type TodojoTask,
} from "./bridge.js";
import { renderProbeControls } from "./display-probe-ui.js";
import {
  lastCompletedTask,
  orderedTasks,
  taskDurationMs,
} from "./task-grid.js";

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

/** Stateful presentation shell: all task facts are snapshots from the MCP server. */
export class TodojoWidget {
  private plan: TodojoPlan | undefined;
  private planId: string | undefined;
  private mode: Mode = "full";
  private drawer: Drawer;
  private phase: "loading" | "ready" | "stale" | "error" = "loading";
  private lastResponseAt = 0;
  private retryMs = activePollMs;
  private connectRetryMs = activePollMs;
  private pollTimer: number | undefined;
  private connectTimer: number | undefined;
  private tickTimer: number | undefined;
  private unlisten: (() => void) | undefined;
  private unlistenProbe: (() => void) | undefined;
  private unlistenHostContext: (() => void) | undefined;
  private hasProbed = false;
  private probeClaimUnavailable = false;
  private probeState: DisplayProbeState | undefined;
  private destroyed = false;
  private connecting = false;
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
    if (this.bridge.onDisplayProbeState) {
      this.unlistenProbe = this.bridge.onDisplayProbeState((state) => {
        this.probeState = state;
        this.render();
      });
    }
    if (this.bridge.onHostContextChange) {
      this.unlistenHostContext = this.bridge.onHostContextChange(() => {
        if (this.bridge.getDisplayMode) {
          const mode = this.bridge.getDisplayMode();
          if (this.probeState && mode) {
            this.probeState = { ...this.probeState, currentMode: mode };
          }
        }
        this.render();
      });
    }
    window.addEventListener("online", this.wake);
    document.addEventListener("visibilitychange", this.wake);
    this.tickTimer = window.setInterval(() => this.renderTimers(), 250);
    this.render();
    await this.connect();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pollTimer) window.clearTimeout(this.pollTimer);
    if (this.connectTimer) window.clearTimeout(this.connectTimer);
    if (this.tickTimer) window.clearInterval(this.tickTimer);
    this.unlisten?.();
    this.unlistenProbe?.();
    this.unlistenHostContext?.();
    window.removeEventListener("online", this.wake);
    document.removeEventListener("visibilitychange", this.wake);
  }

  private wake = (): void => {
    if (document.hidden) return;
    if (this.planId) void this.refresh(true);
    else this.scheduleConnect(true);
  };

  private async connect(): Promise<void> {
    if (this.destroyed || this.planId || this.connecting) return;
    this.connecting = true;
    let failed = false;
    try {
      await this.bridge.connect();
      this.connectRetryMs = activePollMs;
      if (!this.hasProbed && this.bridge.probeDisplayMode) {
        this.hasProbed = true;
        if (!this.bridge.claimDisplayProbe) {
          void this.bridge.probeDisplayMode();
        } else {
          try {
            if (await this.bridge.claimDisplayProbe()) {
              void this.bridge.probeDisplayMode();
            }
          } catch {
            this.probeClaimUnavailable = true;
            this.render();
          }
        }
      }
    } catch {
      failed = true;
      if (!this.destroyed && !this.planId) {
        this.phase = "error";
        this.render();
      }
    } finally {
      this.connecting = false;
      if (failed && !this.destroyed && !this.planId) this.scheduleConnect();
    }
  }

  private scheduleConnect(immediate = false): void {
    if (this.destroyed || this.planId || this.connecting) return;
    if (this.connectTimer) window.clearTimeout(this.connectTimer);
    const delay = immediate ? 0 : this.connectRetryMs;
    this.connectRetryMs = Math.min(this.connectRetryMs * 2, 16_000);
    this.connectTimer = window.setTimeout(() => {
      this.connectTimer = undefined;
      void this.connect();
    }, delay);
  }

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
    if (this.connectTimer) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
    }
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

  private focusTask(plan: TodojoPlan): TodojoTask | undefined {
    const tasks = orderedTasks(plan);
    const identified = tasks.find((task) => task.id === plan.current_task_id);
    return (
      (identified?.status === "active" || identified?.status === "blocked"
        ? identified
        : undefined) ??
      tasks.find(
        (task) => task.status === "active" || task.status === "blocked",
      ) ??
      lastCompletedTask(plan)
    );
  }

  private taskCard(
    task: TodojoTask,
    role: "CURRENT" | "NEXT" | "RECENT",
  ): string {
    const selected =
      this.drawer?.kind === "task" && this.drawer.task.id === task.id;
    const label = `${role} ${task.display_id}, ${task.status}, ${task.title}`;
    const activeDot =
      task.status === "active"
        ? '<span class="todojo__dot" aria-hidden="true"></span>'
        : "";
    const reason =
      task.status === "blocked" && task.block_reason
        ? `<span class="todojo__reason">${escapeHtml(task.block_reason)}</span>`
        : "";
    const description = task.description
      ? `<span class="todojo__description">${escapeHtml(task.description)}</span>`
      : "";
    const statusLabel =
      role === "CURRENT"
        ? task.status === "blocked"
          ? "BLOCKED"
          : task.status === "completed"
            ? "COMPLETE"
            : "CURRENT"
        : role === "RECENT"
          ? "COMPLETE"
          : "NEXT";
    return `<button class="todojo__card todojo__card--${task.status} todojo__card--${role.toLowerCase()}${selected ? " todojo__card--selected" : ""}" data-task-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(label)}" aria-pressed="${selected}"><span class="todojo__meta">${activeDot}${statusLabel} · ${escapeHtml(task.display_id)}<span class="todojo__timer" data-task-timer>${duration(this.currentTaskMs(task))}</span></span><span class="todojo__task-title" data-title>${escapeHtml(task.title)}</span>${reason}${description}</button>`;
  }

  private render(): void {
    const plan = this.plan;
    const probe = renderProbeControls(
      !!this.bridge.probeDisplayMode,
      this.probeState,
    );
    if (this.probeClaimUnavailable) {
      probe.status =
        '<div class="todojo__probe-status" data-probe-status="failure" aria-live="polite">Automatic PiP diagnostic claim unavailable; use Try PiP to retry.</div>';
    }
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
    this.root.innerHTML = `<section class="todojo" aria-label="ToDoJo live task plan"><header class="todojo__header"><span class="todojo__brand">LIVE TASKS</span>${plan?.title ? `<span class="todojo__title">${escapeHtml(plan.title)}</span>` : ""}<span class="todojo__stat" data-work-timer>WORK ${duration(this.currentWorkMs())}</span>${probe.button}<button class="todojo__mode" data-mode>${this.mode === "full" ? "Compact" : "Full"}</button></header>${probe.status}<div class="todojo__status" data-state="${this.phase}" aria-live="polite">${status}</div>${content}${this.drawerHtml(plan)}</section>`;
    this.root
      .querySelector("[data-probe-action='try-pip']")
      ?.addEventListener("click", () => {
        if (this.bridge.probeDisplayMode) {
          this.probeClaimUnavailable = false;
          this.render();
          void this.bridge.probeDisplayMode();
        }
      });
    this.root
      .querySelector("[data-probe-action='return-inline']")
      ?.addEventListener("click", async () => {
        if (this.bridge.requestDisplayMode) {
          try {
            await this.bridge.requestDisplayMode("inline");
            if (this.probeState) {
              this.probeState = { ...this.probeState, currentMode: "inline" };
            }
          } catch {
            const prior = this.probeState;
            this.probeState = {
              status: "failure",
              result: {
                timestamp: new Date().toISOString(),
                advertised: prior?.result?.advertised ?? ["inline"],
                actual: null,
                outcome: "error",
              },
              currentMode: prior?.currentMode ?? "pip",
              telemetryFailed: prior?.telemetryFailed,
            };
          }
          this.render();
        }
      });
    this.root.querySelector("[data-mode]")?.addEventListener("click", () => {
      this.mode = this.mode === "full" ? "compact" : "full";
      this.drawer = undefined;
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
    this.root.querySelector("[data-close]")?.addEventListener("click", () => {
      this.drawer = undefined;
      this.render();
    });
    this.fitTitles();
  }

  private fullGrid(plan: TodojoPlan): string {
    const tasks = orderedTasks(plan);
    const focus = this.focusTask(plan);
    const queued = tasks.filter((task) => task.status === "queued");
    const completed = tasks.filter((task) => task.status === "completed");
    const recent = completed
      .filter((task) => task.id !== focus?.id)
      .sort((left, right) => {
        const leftTime = Date.parse(left.completed_at ?? "") || 0;
        const rightTime = Date.parse(right.completed_at ?? "") || 0;
        return rightTime - leftTime || right.order - left.order;
      });
    const secondary = queued.length
      ? queued.slice(0, focus ? 2 : 3)
      : recent.slice(0, 2);
    const cards = [
      ...(focus ? [this.taskCard(focus, "CURRENT")] : []),
      ...secondary.map((task) =>
        this.taskCard(task, queued.length ? "NEXT" : "RECENT"),
      ),
    ].join("");
    return `<div class="todojo__full" data-view="full" aria-label="Full task view"><div class="todojo__grid">${cards}</div><footer class="todojo__footer"><button class="todojo__footer-button" data-next aria-label="Show ${queued.length} queued tasks">${queued.length} queued</button><span aria-hidden="true">·</span><button class="todojo__footer-button" data-done aria-label="Show task history, ${completed.length} completed tasks">${completed.length} done</button></footer></div>`;
  }

  private compactGrid(plan: TodojoPlan): string {
    const focus = this.focusTask(plan);
    const queued = plan.tasks.filter((task) => task.status === "queued").length;
    const completed = plan.tasks.filter(
      (task) => task.status === "completed",
    ).length;
    const kind = queued ? "next" : "done";
    const selected =
      this.drawer?.kind === "task" && this.drawer.task.id === focus?.id;
    const label =
      focus?.status === "blocked"
        ? "BLOCKED"
        : focus?.status === "completed"
          ? "DONE"
          : "NOW";
    const focusHtml = focus
      ? `<button class="todojo__quick todojo__quick--${focus.status}${selected ? " todojo__quick--selected" : ""}" data-task-id="${escapeHtml(focus.id)}" aria-label="${escapeHtml(`${label} ${focus.display_id}, ${focus.status}, ${focus.title}`)}" aria-pressed="${selected}"><span class="todojo__quick-label">${label} · ${escapeHtml(focus.display_id)}</span><span class="todojo__quick-title">${escapeHtml(focus.title)}</span><span class="todojo__timer" data-task-timer>${duration(this.currentTaskMs(focus))}</span></button>`
      : '<span class="todojo__quick-empty">No current task</span>';
    return `<div class="todojo__compact" data-view="compact" aria-label="Compact task view">${focusHtml}<button class="todojo__compact-count" data-${kind} aria-label="${kind === "next" ? `Show ${queued} queued tasks` : `Show task history, ${completed} completed tasks`}">${kind === "next" ? `+${queued} queued` : `History ${completed}`}</button></div>`;
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
      let size = title.closest(".todojo__card--current") ? 17 : 14;
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
