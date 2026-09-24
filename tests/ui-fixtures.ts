import type { Page } from "@playwright/test";

export type FixtureState =
  | "active"
  | "blocked"
  | "completed"
  | "sparse"
  | "skipped";

const base = "2026-09-24T12:00:00.000Z";
const id = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

export function planFixture(state: FixtureState = "active", long = false) {
  const titles = long
    ? [
        "Verify a deliberately long task title remains readable in two measured lines",
        "Consolidate snapshots",
        "Run regression checks",
        "Package evidence",
      ]
    : [
        "Trace completed state",
        "Consolidate snapshots",
        "Run regression checks",
        "Package evidence",
      ];
  const tasks = titles.map((title, index) => ({
    id: id(index + 1),
    display_id: `T${index + 1}`,
    title,
    order: index + 1,
    status: index === 0 ? "completed" : index === 1 ? "active" : "queued",
    description: index === 1 ? "Authoritative description" : undefined,
    intervals:
      index === 0
        ? [{ started_at: base, ended_at: "2026-09-24T12:01:12.000Z" }]
        : index === 1
          ? [{ started_at: "2026-09-24T12:02:09.000Z" }]
          : [],
    ...(index === 0 ? { completed_at: "2026-09-24T12:01:12.000Z" } : {}),
  }));
  if (state === "blocked") {
    tasks[1].status = "blocked";
    tasks[1].block_reason =
      "Waiting for the physical device to reconnect after a long authoritative reason.";
    tasks[1].intervals[0].ended_at = "2026-09-24T12:02:34.000Z";
  }
  if (state === "skipped") {
    tasks[3].status = "skipped";
    tasks[3].intervals = [
      { started_at: base, ended_at: "2026-09-24T12:00:05.000Z" },
    ];
  }
  if (state === "completed")
    tasks.forEach((task) => {
      task.status = "completed";
      if (task.intervals[0])
        task.intervals[0].ended_at ??= "2026-09-24T12:02:34.000Z";
    });
  const selected = state === "sparse" ? tasks.slice(0, 1) : tasks;
  return {
    plan_id: id(99),
    title: "Recorded plan",
    as_of: "2026-09-24T12:03:00.000Z",
    work_ms:
      state === "active" ? 123_000 : state === "sparse" ? 72_000 : 97_000,
    current_task_id:
      state === "blocked" || state === "active" ? id(2) : undefined,
    version: 1,
    status: state === "completed" ? "completed" : "active",
    tasks: selected,
  };
}

export async function installWidgetBridge(
  page: Page,
  plan: ReturnType<typeof planFixture>,
  options: { fail?: boolean; latencyMs?: number | number[] } = {},
): Promise<void> {
  await page.addInitScript(
    ({ initial, fail, latencyMs }) => {
      let listener: ((value: unknown) => void) | undefined;
      let latest = initial;
      let shouldFail = fail;
      let delays = Array.isArray(latencyMs) ? latencyMs : [latencyMs];
      let pollCount = 0;
      (
        window as unknown as {
          __todojoSetPlan?: (plan: unknown, notify?: boolean) => void;
          __todojoFail?: (value: boolean) => void;
          __todojoSetLatency?: (value: number) => void;
          __todojoPollCount?: () => number;
        }
      ).__todojoSetPlan = (plan, notify = true) => {
        latest = plan;
        if (notify) listener?.({ structuredContent: plan });
      };
      (
        window as unknown as { __todojoFail?: (value: boolean) => void }
      ).__todojoFail = (value) => {
        shouldFail = value;
      };
      (
        window as unknown as { __todojoSetLatency: (value: number) => void }
      ).__todojoSetLatency = (value) => {
        delays = [value];
      };
      (
        window as unknown as { __todojoPollCount: () => number }
      ).__todojoPollCount = () => pollCount;
      (
        window as unknown as { __TODOJO_TEST_BRIDGE__: unknown }
      ).__TODOJO_TEST_BRIDGE__ = {
        connect: async () => {
          listener?.({ structuredContent: latest });
        },
        onToolResult: (next: (value: unknown) => void) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        getPlan: async () => {
          pollCount += 1;
          const response = latest;
          const delayMs = delays[(pollCount - 1) % delays.length] ?? 0;
          if (delayMs)
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          if (shouldFail) throw new Error("offline");
          return response;
        },
      };
    },
    {
      initial: plan,
      fail: options.fail ?? false,
      latencyMs: options.latencyMs ?? 0,
    },
  );
}
