import { expect, test } from "@playwright/test";
import {
  installWidgetBridge,
  mount,
  planFixture,
  resourceHtml,
} from "./ui-fixtures.js";

test("Full uses three columns for current and two queued tasks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 600 });
  await mount(page);
  const cards = page.locator("[data-view=full] .todojo__card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("CURRENT · T2");
  await expect(cards.nth(1)).toContainText("NEXT · T3");
  await expect(cards.nth(2)).toContainText("NEXT · T4");
  await expect(page.locator(".todojo__description")).toHaveCount(1);
  await expect(page.locator(".todojo__description")).toContainText(
    "Authoritative description",
  );
  await expect(
    page.getByRole("button", { name: "Show 2 queued tasks" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show task history, 1 completed tasks" }),
  ).toBeVisible();
  const boxes = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().toJSON()),
  );
  expect(boxes[0].x).toBeLessThan(boxes[1].x);
  expect(boxes[1].x).toBeLessThan(boxes[2].x);
  expect(boxes[0].width).toBeGreaterThan(boxes[1].width);
  expect(Math.round(boxes[1].width)).toBe(Math.round(boxes[2].width));
  await page.getByRole("button", { name: "Show 2 queued tasks" }).click();
  await expect(
    page.getByRole("complementary", { name: "Upcoming queue" }),
  ).toContainText("T4 · Package evidence");
  await page.getByRole("button", { name: "Close details" }).click();
  await page
    .getByRole("button", { name: "Show task history, 1 completed tasks" })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Task history" }),
  ).toContainText("T1 · Trace completed state");
});

test("Compact shows one current row and an accessible queue control", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 600 });
  await mount(page);
  const fullHeight = await page
    .locator(".todojo")
    .evaluate((node) => node.getBoundingClientRect().height);
  await page.getByRole("button", { name: "Compact" }).click();
  const compact = page.locator("[data-view=compact]");
  await expect(compact.locator("button")).toHaveCount(2);
  await expect(compact).toContainText("NOW · T2");
  await expect(compact).toContainText("Consolidate snapshots");
  await expect(compact).not.toContainText("Run regression checks");
  await expect(compact).not.toContainText("Authoritative description");
  const compactHeight = await page
    .locator(".todojo")
    .evaluate((node) => node.getBoundingClientRect().height);
  expect(compactHeight).toBeLessThan(fullHeight * 0.7);
  const count = page.getByRole("button", { name: "Show 2 queued tasks" });
  await page.getByRole("button", { name: "Full" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".todojo__quick")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(count).toBeFocused();
  await count.click();
  await expect(
    page.getByRole("complementary", { name: "Upcoming queue" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  const current = page.locator(".todojo__quick");
  await current.click();
  await expect(current).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Task details")).toContainText(
    "Authoritative description",
  );
  await current.click();
  await expect(page.getByLabel("Task details")).toHaveCount(0);
  await count.click();
  await expect(
    page.getByRole("complementary", { name: "Upcoming queue" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Full" }).click();
  await expect(
    page.getByRole("complementary", { name: "Upcoming queue" }),
  ).toHaveCount(0);
  await expect(page.locator(".todojo__card--current")).toContainText(
    "Consolidate snapshots",
  );
});

test("Full and Compact handle blocked, sparse, completed, and narrow layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mount(page, "blocked");
  const blocked = page.locator(".todojo__card--blocked");
  await expect(blocked).toContainText("Waiting for the physical device");
  await expect(page.locator("[data-view=full] .todojo__card")).toHaveCount(3);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: "Compact" }).click();
  await expect(page.locator(".todojo__quick--blocked")).toContainText(
    "BLOCKED · T2",
  );
  await page.locator(".todojo__quick--blocked").click();
  await expect(page.getByLabel("Task details")).toContainText(
    "Waiting for the physical device",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);

  await mount(page, "sparse");
  await expect(page.locator("[data-view=full] .todojo__card")).toHaveCount(1);
  await expect(page.locator(".todojo__card--current")).toContainText(
    "Trace completed state",
  );
  await expect(
    page.getByRole("button", { name: "Show 0 queued tasks" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Compact" }).click();
  await expect(
    page.getByRole("button", { name: "Show task history, 1 completed tasks" }),
  ).toBeVisible();

  await mount(page, "completed");
  await expect(page.locator("[data-view=full] .todojo__card")).toHaveCount(3);
  await expect(
    page.locator("[data-view=full] .todojo__card--recent"),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Show task history, 4 completed tasks" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Compact" }).click();
  await expect(page.locator(".todojo__quick--completed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show task history, 4 completed tasks" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

test("Full shows queued tasks without an empty focus tile", async ({
  page,
}) => {
  const plan = planFixture();
  plan.tasks = plan.tasks.map((task) => ({
    ...task,
    status: "queued",
    intervals: [],
    completed_at: undefined,
  }));
  plan.current_task_id = undefined;
  await installWidgetBridge(page, plan);
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );
  await expect(page.locator("[data-view=full] .todojo__card")).toHaveCount(3);
  await expect(page.locator(".todojo__card--current")).toHaveCount(0);
  await expect(page.locator(".todojo__full")).not.toContainText("No task");
  await expect(
    page.getByRole("button", { name: "Show 4 queued tasks" }),
  ).toBeVisible();
});

test("narrow Full grids use two columns for sparse and no-focus plans", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const oneQueued = planFixture();
  oneQueued.tasks = oneQueued.tasks.filter((task) =>
    ["T1", "T2", "T3"].includes(task.display_id),
  );
  await installWidgetBridge(page, oneQueued);
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );
  const grid = page.locator(".todojo__grid");
  await expect(grid.locator(".todojo__card")).toHaveCount(2);
  expect(
    await grid.evaluate(
      (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(2);
  const focus = await grid.locator(".todojo__card--current").boundingBox();
  const next = await grid.locator(".todojo__card--queued").boundingBox();
  expect(focus?.width).toBeCloseTo(next?.width ?? 0, 0);

  const noFocus = planFixture();
  noFocus.tasks = noFocus.tasks.slice(0, 3).map((task) => ({
    ...task,
    status: "queued",
    intervals: [],
    completed_at: undefined,
  }));
  noFocus.current_task_id = undefined;
  await installWidgetBridge(page, noFocus);
  await page.reload();
  await expect(grid.locator(".todojo__card")).toHaveCount(3);
  expect(
    await grid.evaluate(
      (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(2);
});

test("skipped tasks remain visible in history with a frozen timer and strike-through", async ({
  page,
}) => {
  await mount(page, "skipped");
  await expect(page.locator(".todojo__card--skipped")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show task history, 1 completed tasks" })
    .click();
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
  await expect(blocked.locator(".todojo__reason")).toBeVisible();
  const title = page.locator(".todojo__task-title").nth(0);
  expect(
    await title.evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
  ).toBe(true);
});
