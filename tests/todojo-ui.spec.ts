import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { installWidgetBridge, planFixture } from "./ui-fixtures.js";

function resourceHtml(): string {
  const bundle = readFileSync(resolve("dist/todojo-widget.js"), "utf8");
  return `<!doctype html><html><body><main id="todojo"></main><script>${bundle}</script></body></html>`;
}

async function mount(
  page: Parameters<typeof installWidgetBridge>[0],
  state: Parameters<typeof planFixture>[0] = "active",
  long = false,
) {
  await installWidgetBridge(page, planFixture(state, long));
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );
  await expect(page.locator("[data-view]")).toBeVisible();
}

test("Full grid is a real equal 2x2 task layout", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 600 });
  await mount(page);
  const cards = page.locator("[data-view=full] .todojo__card");
  await expect(cards).toHaveCount(4);
  const geometry = await cards.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return [box.width, box.height];
    }),
  );
  expect(new Set(geometry.map(([width]) => Math.round(width))).size).toBe(1);
  expect(new Set(geometry.map(([, height]) => Math.round(height))).size).toBe(
    1,
  );
  await expect(cards.nth(0)).toContainText("LAST");
  await expect(cards.nth(1)).toContainText("CURRENT");
});

test("Compact has two equal-height rows, neutral fixed anchors, and drawers", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Compact" }).click();
  const rows = page.locator(".todojo__compact-row");
  await expect(rows).toHaveCount(2);
  const cells = page.locator(".todojo__compact-row > button");
  await expect(cells).toHaveCount(6);
  const metrics = await page.locator(".todojo__compact").evaluate((grid) =>
    [...grid.children].map((row) => {
      const cells = [...row.children].map((cell) =>
        cell.getBoundingClientRect(),
      );
      return {
        height: row.getBoundingClientRect().height,
        anchor: cells[0].width,
        tasks: [cells[1].width, cells[2].width],
      };
    }),
  );
  expect(Math.round(metrics[0].height)).toBe(Math.round(metrics[1].height));
  expect(Math.round(metrics[0].anchor)).toBe(Math.round(metrics[1].anchor));
  expect(Math.round(metrics[0].tasks[0])).toBe(Math.round(metrics[0].tasks[1]));
  await page
    .getByRole("button", { name: /Show task history, 1 completed tasks/ })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Task history" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  const firstCard = page.locator("[data-task-id]").nth(0);
  await expect(firstCard).toHaveAttribute("aria-pressed", "false");
  await firstCard.click();
  await expect(page.getByLabel("Task details")).toBeVisible();
  await expect(firstCard).toHaveAttribute("aria-pressed", "true");
  await firstCard.click();
  await expect(page.getByLabel("Task details")).toHaveCount(0);
  await expect(firstCard).toHaveAttribute("aria-pressed", "false");
});

test("skipped tasks remain visible in history with a frozen timer and strike-through", async ({
  page,
}) => {
  await mount(page, "skipped");
  await expect(page.locator(".todojo__card--skipped")).toHaveCount(0);
  await page.getByRole("button", { name: "DONE 1" }).click();
  const skipped = page.locator(".todojo__history-skipped");
  await expect(skipped).toContainText("T4 · Package evidence · Skipped · 0:05");
  expect(
    await skipped.evaluate((node) => getComputedStyle(node).textDecorationLine),
  ).toContain("line-through");
  expect(await skipped.evaluate((node) => getComputedStyle(node).color)).toBe(
    "rgb(158, 155, 149)",
  );
  await page.waitForTimeout(1_100);
  await expect(skipped).toContainText("0:05");
});

test("responsive sparse, blocked, and long-title states preserve geometry", async ({
  page,
}) => {
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    await mount(page, "sparse");
    const overflow = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll<HTMLElement>("*")]
        .filter(
          (element) =>
            element.getBoundingClientRect().right > window.innerWidth + 1,
        )
        .slice(0, 8)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          right: element.getBoundingClientRect().right,
        })),
    }));
    expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(
      overflow.viewport,
    );
  }
  await mount(page, "blocked", true);
  await expect(page.locator(".todojo__card--blocked")).toContainText(
    "Waiting for the physical device",
  );
  const blocked = page.locator(".todojo__card--blocked");
  const others = page.locator("[data-view=full] .todojo__card");
  expect(
    await blocked.evaluate((node) =>
      Math.round(node.getBoundingClientRect().height),
    ),
  ).toBe(
    await others
      .nth(0)
      .evaluate((node) => Math.round(node.getBoundingClientRect().height)),
  );
  const title = page.locator(".todojo__task-title").nth(0);
  expect(
    await title.evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
  ).toBe(true);
});

test("only active dot breathes and reduced motion disables it", async ({
  page,
}) => {
  await mount(page);
  await expect(page.locator(".todojo__dot")).toHaveCount(1);
  await expect(page.locator(".todojo__card--blocked .todojo__dot")).toHaveCount(
    0,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".todojo__dot")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
});

test("stale state is visible during a failed refresh and recovers on wake", async ({
  page,
}) => {
  await installWidgetBridge(page, planFixture(), { fail: true });
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );
  const polls = () =>
    page.evaluate(() =>
      (
        window as unknown as { __todojoPollCount: () => number }
      ).__todojoPollCount(),
    );
  await expect.poll(polls, { timeout: 3_000 }).toBe(1);
  await page.waitForTimeout(2_000);
  expect(await polls()).toBe(1);
  await expect.poll(polls, { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("Waiting for a server update…")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.evaluate(() => {
    (
      window as unknown as { __todojoFail: (value: boolean) => void }
    ).__todojoFail(false);
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.locator("[data-state=ready]")).toBeVisible();
});

function timerSeconds(value: string | null): number {
  const match = value?.match(/(\d+):(\d{2})/);
  if (!match) throw new Error(`Missing timer in ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

test("active card, WORK, and drawer timers use as_of plus monotonic elapsed through jitter", async ({
  page,
}) => {
  // Deliberately skew the browser wall clock years ahead of the server.
  await page.addInitScript(() => {
    Date.now = () => Date.parse("2035-01-01T00:00:00.000Z");
  });
  const plan = planFixture();
  await installWidgetBridge(page, plan, { latencyMs: [0, 2_000] });
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );
  const card = page.locator(".todojo__card--active [data-task-timer]");
  const work = page.locator("[data-work-timer]");
  await expect(card).toHaveText("0:51");
  await expect(work).toHaveText("WORK 2:03");
  await page.locator(".todojo__card--active").click();
  const drawer = page.locator("[data-drawer-timer]");
  await expect(drawer).toBeVisible();
  await expect
    .poll(async () => timerSeconds(await card.textContent()), {
      timeout: 4_000,
    })
    .toBeGreaterThanOrEqual(53);
  const before = timerSeconds(await card.textContent());
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          (
            window as unknown as { __todojoPollCount: () => number }
          ).__todojoPollCount(),
        ),
      { timeout: 6_000 },
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () => timerSeconds(await card.textContent()), {
      timeout: 4_000,
    })
    .toBeGreaterThanOrEqual(before + 2);
  expect(timerSeconds(await drawer.textContent())).toBeGreaterThanOrEqual(
    before + 2,
  );
  expect(timerSeconds(await work.textContent())).toBeGreaterThanOrEqual(125);

  const beforeRefresh = timerSeconds(await card.textContent());
  await page.evaluate((snapshot) => {
    const set = (
      window as unknown as {
        __todojoSetPlan: (plan: unknown) => void;
      }
    ).__todojoSetPlan;
    set(snapshot);
    set({ ...snapshot, as_of: "2026-09-24T12:02:00.000Z", work_ms: 0 });
  }, plan);
  expect(timerSeconds(await card.textContent())).toBeGreaterThanOrEqual(
    beforeRefresh,
  );
  const pollsBeforeDelay = await page.evaluate(() =>
    (
      window as unknown as { __todojoPollCount: () => number }
    ).__todojoPollCount(),
  );
  await page.evaluate(() => {
    (
      window as unknown as { __todojoSetLatency: (value: number) => void }
    ).__todojoSetLatency(2_000);
    window.dispatchEvent(new Event("online"));
  });
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          window as unknown as { __todojoPollCount: () => number }
        ).__todojoPollCount(),
      ),
    )
    .toBeGreaterThan(pollsBeforeDelay);
  const newer = {
    ...plan,
    version: 2,
    as_of: "2026-09-24T12:03:05.000Z",
    work_ms: 128_000,
  };
  await page.evaluate((snapshot) => {
    (
      window as unknown as { __todojoSetPlan: (plan: unknown) => void }
    ).__todojoSetPlan(snapshot);
  }, newer);
  expect(timerSeconds(await card.textContent())).toBeGreaterThanOrEqual(
    beforeRefresh,
  );
  expect(timerSeconds(await work.textContent())).toBeGreaterThanOrEqual(128);
  const afterNewer = timerSeconds(await card.textContent());
  await page.waitForTimeout(2_100);
  expect(timerSeconds(await card.textContent())).toBeGreaterThanOrEqual(
    afterNewer,
  );
  expect(timerSeconds(await work.textContent())).toBeGreaterThanOrEqual(128);
});

test("blocked and completed timers freeze at authoritative interval totals", async ({
  page,
}) => {
  await mount(page, "blocked");
  const card = page.locator(".todojo__card--blocked [data-task-timer]");
  await expect(card).toHaveText("0:25");
  await page.locator(".todojo__card--blocked").click();
  await expect(page.locator("[data-drawer-timer]")).toHaveText("0:25");
  await page.waitForTimeout(1_200);
  await expect(card).toHaveText("0:25");
  await expect(page.locator("[data-work-timer]")).toHaveText("WORK 1:37");
  await mount(page, "completed");
  await expect(page.locator("[data-work-timer]")).toHaveText("WORK 1:37");
  await page.waitForTimeout(1_200);
  await expect(page.locator("[data-work-timer]")).toHaveText("WORK 1:37");
});

test("completed plan polling eventually discovers a later added task", async ({
  page,
}) => {
  const plan = planFixture("completed");
  await installWidgetBridge(page, plan);
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );
  await expect(page.getByRole("button", { name: "LATER 0" })).toBeVisible();
  const added = {
    ...plan,
    version: 2,
    tasks: [
      ...plan.tasks,
      {
        ...planFixture().tasks[3],
        id: "00000000-0000-4000-8000-000000000099",
        display_id: "T5",
        title: "Added after completion",
        order: 5,
        status: "queued",
        intervals: [],
      },
    ],
  };
  await page.evaluate((snapshot) => {
    (
      window as unknown as {
        __todojoSetPlan: (plan: unknown, notify?: boolean) => void;
      }
    ).__todojoSetPlan(snapshot, false);
  }, added);
  await expect(page.getByRole("button", { name: "LATER 1" })).toBeVisible({
    timeout: 13_000,
  });
});

test("Full LAST follows completed_at after reordering", async ({ page }) => {
  const plan = planFixture();
  const older = {
    ...plan.tasks[2],
    status: "completed",
    completed_at: "2026-09-24T12:01:00.000Z",
    intervals: [
      {
        started_at: "2026-09-24T12:00:30.000Z",
        ended_at: "2026-09-24T12:01:00.000Z",
      },
    ],
    order: 10,
  };
  plan.tasks[2] = older;
  await installWidgetBridge(page, plan);
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );
  await expect(
    page.locator("[data-view=full] .todojo__card").first(),
  ).toContainText("Trace completed state");
});

test("untrusted IDs and labels render as text without adding markup", async ({
  page,
}) => {
  const plan = planFixture();
  plan.tasks[1].id = 'id" onclick="window.__injected=1';
  plan.tasks[1].display_id = '<img src=x onerror="window.__injected=1">';
  plan.current_task_id = plan.tasks[1].id;
  await installWidgetBridge(page, plan);
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );
  const card = page.locator(".todojo__card--active");
  await expect(card).toHaveAttribute("data-task-id", plan.tasks[1].id);
  await expect(card).toContainText(plan.tasks[1].display_id);
  expect(await page.locator(".todojo__card--active img").count()).toBe(0);
  await card.click();
  await expect(page.getByLabel("Task details")).toContainText(
    plan.tasks[1].display_id,
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { __injected?: number }).__injected,
    ),
  ).toBeUndefined();
});

test("equal-version polling keeps keyboard focus and the open drawer", async ({
  page,
}) => {
  await mount(page);
  const card = page.locator(".todojo__card--active");
  await card.click();
  const close = page.getByRole("button", { name: "Close details" });
  await close.focus();
  await expect(close).toBeFocused();
  const initialPolls = await page.evaluate(() =>
    (
      window as unknown as { __todojoPollCount: () => number }
    ).__todojoPollCount(),
  );
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          (
            window as unknown as { __todojoPollCount: () => number }
          ).__todojoPollCount(),
        ),
      { timeout: 5_000 },
    )
    .toBeGreaterThan(initialPolls);
  await page.waitForTimeout(100);
  await expect(close).toBeFocused();
  await expect(page.getByLabel("Task details")).toBeVisible();
});
