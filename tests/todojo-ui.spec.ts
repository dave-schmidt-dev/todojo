import { expect, test } from "@playwright/test";
import {
  installWidgetBridge,
  mount,
  planFixture,
  resourceHtml,
} from "./ui-fixtures.js";

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
  await expect(page.locator("[data-state=ready]")).toHaveCount(1);
});

test("initial bridge failure reconnects once without duplicating listeners", async ({
  page,
}) => {
  const recovered = {
    ...planFixture(),
    title: "Recovered authoritative plan",
  };
  await installWidgetBridge(page, planFixture(), { connectFailures: 1 });
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );
  await expect(page.getByText("Unable to refresh task plan.")).toBeVisible();
  await page.evaluate((snapshot) => {
    (
      window as unknown as {
        __todojoSetPlan: (plan: unknown, notify?: boolean) => void;
      }
    ).__todojoSetPlan(snapshot, false);
  }, recovered);
  await expect(page.locator("[data-state=ready]")).toHaveCount(1, {
    timeout: 5_000,
  });
  await expect(page.locator(".todojo__title")).toHaveText(
    "Recovered authoritative plan",
  );
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __todojoConnectCount: () => number }
      ).__todojoConnectCount(),
    ),
  ).toBe(2);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __todojoListenerCount: () => number }
      ).__todojoListenerCount(),
    ),
  ).toBe(1);
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
  await expect(
    page.getByRole("button", { name: "Show 0 queued tasks" }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("button", { name: "Show 1 queued tasks" }),
  ).toBeVisible({
    timeout: 13_000,
  });
});

test("Full focus follows completed_at after reordering when work is finished", async ({
  page,
}) => {
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
  plan.tasks[1].status = "completed";
  plan.tasks[3].status = "completed";
  plan.current_task_id = undefined;
  await installWidgetBridge(page, plan);
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );
  await expect(
    page.locator("[data-view=full] .todojo__card--current"),
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
test("active and completed widgets omit placement controls while retaining Full and Compact", async ({
  page,
}) => {
  for (const state of ["active", "completed"] as const) {
    await mount(page, state);
    await expect(page.locator("[data-placement]")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Keep visible|Return to chat/ }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Compact" }).click();
    await expect(page.locator("[data-view=compact]")).toBeVisible();
    await page.getByRole("button", { name: "Full" }).click();
    await expect(page.locator("[data-view=full]")).toBeVisible();
  }
});
