import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { expect, type Page, test } from "@playwright/test";
import {
  installWidgetBridge,
  planFixture,
  resourceHtml,
} from "./ui-fixtures.js";

const supported: McpUiHostContext = {
  displayMode: "inline",
  availableDisplayModes: ["inline", "pip"],
};

async function displayMount(
  page: Page,
  options: Parameters<typeof installWidgetBridge>[2] = {},
): Promise<void> {
  await installWidgetBridge(page, planFixture(), {
    hostContext: supported,
    ...options,
  });
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );
  await expect(page.locator("[data-view]")).toBeVisible();
}

async function requests(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (
      window as unknown as { __todojoDisplayRequests: () => string[] }
    ).__todojoDisplayRequests(),
  );
}

async function context(page: Page, value: McpUiHostContext): Promise<void> {
  await page.evaluate((next) => {
    (
      window as unknown as {
        __todojoSetHostContext: (value: McpUiHostContext) => void;
      }
    ).__todojoSetHostContext(next);
  }, value);
}

async function resolveDisplay(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as { __todojoResolveDisplay: () => void }
    ).__todojoResolveDisplay();
  });
}

async function complete(page: Page): Promise<void> {
  const plan = { ...planFixture("completed"), version: 2 };
  await page.evaluate((next) => {
    (
      window as unknown as { __todojoSetPlan: (plan: unknown) => void }
    ).__todojoSetPlan(next);
  }, plan);
}

test("unsupported hosts and fullscreen-only hosts disable Keep visible truthfully", async ({
  page,
}) => {
  for (const hostContext of [
    {},
    { availableDisplayModes: ["inline"] },
    { availableDisplayModes: ["inline", "fullscreen"] },
  ] as McpUiHostContext[]) {
    await displayMount(page, { hostContext });
    await expect(
      page.getByRole("button", { name: "Keep visible" }),
    ).toBeDisabled();
    await expect(page.getByRole("status")).toContainText(
      "unavailable in this host",
    );
    expect(await requests(page)).toEqual([]);
  }
});

test("pending request is visible, rejects duplicate clicks, and grants pin/unpin", async ({
  page,
}) => {
  await displayMount(page, { manualDisplay: true });
  const keep = page.getByRole("button", { name: "Keep visible" });
  await keep.click();
  await expect(keep).toBeDisabled();
  await expect(page.getByRole("status")).toContainText(
    "Requesting to keep visible",
  );
  await keep.evaluate((button: HTMLButtonElement) => button.click());
  expect(await requests(page)).toEqual(["pip"]);
  await resolveDisplay(page);
  const back = page.getByRole("button", { name: "Return to chat" });
  await expect(back).toBeEnabled();
  await expect(page.getByRole("status")).toContainText("Kept visible by host");
  await back.click();
  await expect(back).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Returning to chat");
  await resolveDisplay(page);
  await expect(keep).toBeEnabled();
  await expect(page.getByRole("status")).toContainText("Returned to chat");
  expect(await requests(page)).toEqual(["pip", "inline"]);
});

test("denial and thrown errors preserve chat placement with live feedback", async ({
  page,
}) => {
  for (const response of ["inline", "error"] as const) {
    await displayMount(page, { displayResponses: [response] });
    await page.getByRole("button", { name: "Keep visible" }).click();
    await expect(
      page.getByRole("button", { name: "Keep visible" }),
    ).toBeEnabled();
    await expect(page.getByRole("status")).toContainText(
      response === "inline"
        ? "Host kept ToDoJo in chat"
        : "Unable to change display mode",
    );
    await expect(
      page.getByRole("button", { name: "Return to chat" }),
    ).toHaveCount(0);
    await expect(page.locator(".todojo__card--active")).toContainText(
      "Consolidate snapshots",
    );
  }
});

test("mobile fullscreen grant reflects actual placement and can return inline", async ({
  page,
}) => {
  await displayMount(page, {
    hostContext: { ...supported, platform: "mobile" },
    displayResponses: ["fullscreen", "inline"],
  });
  await page.getByRole("button", { name: "Keep visible" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Shown fullscreen by host",
  );
  await page.getByRole("button", { name: "Return to chat" }).click();
  await expect(
    page.getByRole("button", { name: "Keep visible" }),
  ).toBeEnabled();
});

test("host dismissal and capability updates change controls without requesting placement", async ({
  page,
}) => {
  await displayMount(page);
  await page.getByRole("button", { name: "Keep visible" }).click();
  await expect(
    page.getByRole("button", { name: "Return to chat" }),
  ).toBeEnabled();
  await context(page, {
    displayMode: "inline",
    availableDisplayModes: ["inline"],
  });
  await expect(
    page.getByRole("button", { name: "Keep visible" }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText(
    "unavailable in this host",
  );
  await context(page, { availableDisplayModes: ["inline", "pip"] });
  await expect(
    page.getByRole("button", { name: "Keep visible" }),
  ).toBeEnabled();
  expect(await requests(page)).toEqual(["pip"]);
});

test("pinned plan keeps polling and task updates retain the explicit plan", async ({
  page,
}) => {
  await displayMount(page);
  await page.getByRole("button", { name: "Keep visible" }).click();
  await expect(
    page.getByRole("button", { name: "Return to chat" }),
  ).toBeEnabled();
  const updated = planFixture();
  updated.version = 2;
  updated.tasks[1].title = "Updated while pinned";
  await page.evaluate((next) => {
    (
      window as unknown as {
        __todojoSetPlan: (plan: unknown, notify: boolean) => void;
      }
    ).__todojoSetPlan(next, false);
    window.dispatchEvent(new Event("online"));
  }, updated);
  await expect(page.locator(".todojo__card--active")).toContainText(
    "Updated while pinned",
  );
  await expect(
    page.getByRole("button", { name: "Return to chat" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __todojoPollCount: () => number }
      ).__todojoPollCount(),
    ),
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __todojoRequestedPlanIds: () => string[] }
      ).__todojoRequestedPlanIds(),
    ),
  ).toEqual([updated.plan_id]);
});

test("completion returns inline once and leaves completed tasks visible", async ({
  page,
}) => {
  await displayMount(page);
  await page.getByRole("button", { name: "Keep visible" }).click();
  await expect(
    page.getByRole("button", { name: "Return to chat" }),
  ).toBeEnabled();
  await complete(page);
  await expect(
    page.getByRole("button", { name: "Keep visible" }),
  ).toBeDisabled();
  await expect(page.locator(".todojo__card--completed")).toHaveCount(3);
  await complete(page);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  expect(await requests(page)).toEqual(["pip", "inline"]);
});

test("polled completion returns a pinned plan inline once", async ({
  page,
}) => {
  await displayMount(page);
  await page.getByRole("button", { name: "Keep visible" }).click();
  await expect(
    page.getByRole("button", { name: "Return to chat" }),
  ).toBeEnabled();
  const completed = { ...planFixture("completed"), version: 2 };
  await page.evaluate((next) => {
    (
      window as unknown as {
        __todojoSetPlan: (plan: unknown, notify: boolean) => void;
      }
    ).__todojoSetPlan(next, false);
    window.dispatchEvent(new Event("online"));
  }, completed);
  await expect(page.getByRole("status")).toContainText("Returned to chat");
  await expect(
    page.getByRole("button", { name: "Keep visible" }),
  ).toBeDisabled();
  await expect(page.locator(".todojo__card--completed")).toHaveCount(3);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  expect(await requests(page)).toEqual(["pip", "inline"]);
});

test("completion in PiP without inline support remains visible without automatic requests", async ({
  page,
}) => {
  await displayMount(page, {
    hostContext: { displayMode: "pip", availableDisplayModes: ["pip"] },
  });
  await complete(page);
  await expect(page.locator(".todojo__card--completed")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Return to chat" }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Kept visible by host");
  await expect(page.getByRole("status")).toContainText(
    "Return to chat unavailable in this host",
  );
  await complete(page);
  await context(page, { displayMode: "pip" });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  expect(await requests(page)).toEqual([]);
});

test("completion denial or error keeps completion visible and never retries automatically", async ({
  page,
}) => {
  for (const response of ["pip", "error"] as const) {
    await displayMount(page, { displayResponses: ["pip", response] });
    await page.getByRole("button", { name: "Keep visible" }).click();
    await expect(
      page.getByRole("button", { name: "Return to chat" }),
    ).toBeEnabled();
    await complete(page);
    await expect(page.getByRole("status")).toContainText(
      response === "pip"
        ? "Plan complete. Host kept ToDoJo visible"
        : "Plan complete. Unable to return to chat",
    );
    await expect(page.locator(".todojo__card--completed")).toHaveCount(3);
    await complete(page);
    await context(page, { displayMode: "pip" });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    expect(await requests(page)).toEqual(["pip", "inline"]);
  }
});

test("completion during pending pin waits then exits once", async ({
  page,
}) => {
  await displayMount(page, { manualDisplay: true });
  await page.getByRole("button", { name: "Keep visible" }).click();
  await complete(page);
  await expect(page.getByRole("status")).toContainText(
    "Requesting to keep visible",
  );
  expect(await requests(page)).toEqual(["pip"]);
  await resolveDisplay(page);
  await expect(page.getByRole("status")).toContainText(
    "Plan complete. Returning to chat",
  );
  await expect(
    page.getByRole("button", { name: "Return to chat" }),
  ).toBeDisabled();
  await expect.poll(() => requests(page)).toEqual(["pip", "inline"]);
  await resolveDisplay(page);
  await expect(page.getByRole("status")).toContainText("Returned to chat");
});

test("later host dismissal outranks a delayed pin response", async ({
  page,
}) => {
  await displayMount(page, { displayLatencyMs: 300 });
  await page.getByRole("button", { name: "Keep visible" }).click();
  await context(page, { displayMode: "inline" });
  await expect(
    page.getByRole("button", { name: "Keep visible" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Return to chat" }),
  ).toHaveCount(0);
});

test("mock-host Keep visible control fits narrow and wide layouts", async ({
  page,
}) => {
  for (const width of [320, 760]) {
    await page.setViewportSize({ width, height: 700 });
    await displayMount(page);
    await expect(
      page.getByRole("button", { name: "Keep visible" }),
    ).toBeEnabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `.test-profile/todojo-keep-visible-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Compact" }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
});
