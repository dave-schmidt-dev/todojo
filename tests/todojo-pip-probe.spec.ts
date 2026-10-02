import { expect, type Page, test } from "@playwright/test";
import { mount, planFixture, resourceHtml } from "./ui-fixtures.js";

interface InstallProbeOptions {
  mockResponseMode?: "inline" | "pip";
  availableDisplayModes?: ("inline" | "fullscreen" | "pip")[];
  failProbe?: boolean;
  failClaim?: boolean;
}

async function installProbeBridge(
  page: Page,
  options: InstallProbeOptions = {},
): Promise<void> {
  const plan = planFixture("active");
  const mockResponseMode = options.mockResponseMode ?? "inline";
  const advertised = options.availableDisplayModes ?? ["inline"];
  const failProbe = options.failProbe ?? false;
  const failClaim = options.failClaim ?? false;

  await page.addInitScript(
    ({
      initialPlan,
      returnMode,
      advertisedModes,
      shouldFail,
      shouldFailClaim,
    }) => {
      let listener: ((value: unknown) => void) | undefined;
      let probeStateListener: ((state: unknown) => void) | undefined;
      let hostChangeListener: (() => void) | undefined;

      const requestedModes: string[] = [];
      let currentMode: string = returnMode === "pip" ? "pip" : "inline";
      let probeCallCount = 0;

      const probeState = {
        status: "idle",
        currentMode,
      };

      (
        window as unknown as {
          __todojoRequestedDisplayModes: () => string[];
          __todojoProbeCallCount: () => number;
          __todojoTriggerHostModeChange: (mode: string) => void;
        }
      ).__todojoRequestedDisplayModes = () => requestedModes;

      (
        window as unknown as {
          __todojoProbeCallCount: () => number;
        }
      ).__todojoProbeCallCount = () => probeCallCount;

      (
        window as unknown as {
          __todojoTriggerHostModeChange: (mode: string) => void;
        }
      ).__todojoTriggerHostModeChange = (mode: string) => {
        currentMode = mode;
        probeState.currentMode = mode;
        probeStateListener?.(probeState);
        hostChangeListener?.();
      };

      (
        window as unknown as { __TODOJO_TEST_BRIDGE__: unknown }
      ).__TODOJO_TEST_BRIDGE__ = {
        connect: async () => {
          listener?.({ structuredContent: initialPlan });
        },
        getPlan: async () => initialPlan,
        onToolResult: (next: (value: unknown) => void) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        onDisplayProbeState: (next: (state: unknown) => void) => {
          probeStateListener = next;
          next(probeState);
          return () => {
            probeStateListener = undefined;
          };
        },
        onHostContextChange: (next: () => void) => {
          hostChangeListener = next;
          return () => {
            hostChangeListener = undefined;
          };
        },
        getDisplayMode: () => currentMode,
        claimDisplayProbe: async () => {
          if (shouldFailClaim) throw new Error("claim unavailable");
          return true;
        },
        probeDisplayMode: async () => {
          probeCallCount += 1;
          requestedModes.push("pip");

          probeState.status = "pending";
          probeStateListener?.(probeState);

          if (shouldFail) {
            probeState.status = "failure";
            (probeState as Record<string, unknown>).result = {
              timestamp: new Date().toISOString(),
              advertised: advertisedModes,
              actual: null,
              outcome: "error",
            };
            probeStateListener?.(probeState);
            throw new Error("Probe request failed");
          }

          currentMode = returnMode;
          probeState.currentMode = returnMode;
          probeState.status = "returned";
          (probeState as Record<string, unknown>).result = {
            timestamp: new Date().toISOString(),
            advertised: advertisedModes,
            actual: returnMode,
            outcome: returnMode === "pip" ? "success" : "rejected",
          };
          probeStateListener?.(probeState);
          return (probeState as Record<string, unknown>).result;
        },
        requestDisplayMode: async (param: string | { mode: string }) => {
          const mode = typeof param === "string" ? param : param.mode;
          requestedModes.push(mode);
          currentMode = mode;
          probeState.currentMode = mode;
          probeStateListener?.(probeState);
          return { mode };
        },
      };
    },
    {
      initialPlan: plan,
      returnMode: mockResponseMode,
      advertisedModes: advertised,
      shouldFail: failProbe,
      shouldFailClaim: failClaim,
    },
  );
}

test("newly loaded widget makes exactly one requestDisplayMode({mode:'pip'}) after connect", async ({
  page,
}) => {
  await installProbeBridge(page, {
    mockResponseMode: "inline",
    availableDisplayModes: ["inline"],
  });
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );

  const status = page.locator(".todojo__probe-status");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toHaveAttribute("data-probe-status", "returned");
  await expect(status).toContainText("PiP returned inline (rejected)");

  const requestedModes = await page.evaluate(() =>
    (
      window as unknown as { __todojoRequestedDisplayModes: () => string[] }
    ).__todojoRequestedDisplayModes(),
  );
  expect(requestedModes).toEqual(["pip"]);

  const tryPipButton = page.locator("[data-probe-action='try-pip']");
  await expect(tryPipButton).toBeVisible();
  await expect(tryPipButton).toHaveText("Try PiP");
});

test("no recurring forced requests during polling or reconnection", async ({
  page,
}) => {
  await installProbeBridge(page, {
    mockResponseMode: "inline",
  });
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );

  const status = page.locator(".todojo__probe-status");
  await expect(status).toHaveAttribute("data-probe-status", "returned");

  // Simulate wake / visibility change that causes refresh
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });

  await page.waitForTimeout(500);

  const requestedModes = await page.evaluate(() =>
    (
      window as unknown as { __todojoRequestedDisplayModes: () => string[] }
    ).__todojoRequestedDisplayModes(),
  );
  expect(requestedModes).toEqual(["pip"]);
});

test("claim failure suppresses automatic request and leaves manual retry available", async ({
  page,
}) => {
  await installProbeBridge(page, { failClaim: true });
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );

  const status = page.locator(".todojo__probe-status");
  await expect(status).toContainText("claim unavailable");
  const tryPipButton = page.locator("[data-probe-action='try-pip']");
  await expect(tryPipButton).toBeVisible();
  let calls = await page.evaluate(() =>
    (
      window as unknown as { __todojoProbeCallCount: () => number }
    ).__todojoProbeCallCount(),
  );
  expect(calls).toBe(0);

  await tryPipButton.click();
  calls = await page.evaluate(() =>
    (
      window as unknown as { __todojoProbeCallCount: () => number }
    ).__todojoProbeCallCount(),
  );
  expect(calls).toBe(1);
  await expect(status).toHaveAttribute("data-probe-status", "returned");
  await expect(status).toContainText("PiP returned inline (rejected)");
});

test("Try PiP button allows explicit retries", async ({ page }) => {
  await installProbeBridge(page, {
    mockResponseMode: "inline",
  });
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );

  const tryPipButton = page.locator("[data-probe-action='try-pip']");
  await expect(tryPipButton).toBeVisible();

  // Click Try PiP to retry probe explicitly
  await tryPipButton.click();

  const probeCalls = await page.evaluate(() =>
    (
      window as unknown as { __todojoProbeCallCount: () => number }
    ).__todojoProbeCallCount(),
  );
  expect(probeCalls).toBe(2);

  const requestedModes = await page.evaluate(() =>
    (
      window as unknown as { __todojoRequestedDisplayModes: () => string[] }
    ).__todojoRequestedDisplayModes(),
  );
  expect(requestedModes).toEqual(["pip", "pip"]);
});

test("Return inline button appears when actually in pip and switches mode", async ({
  page,
}) => {
  await installProbeBridge(page, {
    mockResponseMode: "pip",
  });
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );

  const status = page.locator(".todojo__probe-status");
  await expect(status).toHaveAttribute("data-probe-status", "returned");
  await expect(status).toContainText("PiP active");

  const returnInlineButton = page.locator(
    "[data-probe-action='return-inline']",
  );
  await expect(returnInlineButton).toBeVisible();
  await expect(returnInlineButton).toHaveText("Return inline");

  // Click Return inline
  await returnInlineButton.click();

  // Button should toggle back to Try PiP
  const tryPipButton = page.locator("[data-probe-action='try-pip']");
  await expect(tryPipButton).toBeVisible();
  await expect(tryPipButton).toHaveText("Try PiP");

  const requestedModes = await page.evaluate(() =>
    (
      window as unknown as { __todojoRequestedDisplayModes: () => string[] }
    ).__todojoRequestedDisplayModes(),
  );
  expect(requestedModes).toEqual(["pip", "inline"]);
});

test("host mode change/dismissal updates view appropriately", async ({
  page,
}) => {
  await installProbeBridge(page, {
    mockResponseMode: "pip",
  });
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(resourceHtml())}`,
  );

  const returnInlineButton = page.locator(
    "[data-probe-action='return-inline']",
  );
  await expect(returnInlineButton).toBeVisible();

  // Simulate host dismissing PiP window (transition to inline)
  await page.evaluate(() => {
    (
      window as unknown as {
        __todojoTriggerHostModeChange: (mode: string) => void;
      }
    ).__todojoTriggerHostModeChange("inline");
  });

  const tryPipButton = page.locator("[data-probe-action='try-pip']");
  await expect(tryPipButton).toBeVisible();
  await expect(tryPipButton).toHaveText("Try PiP");
});

test("existing fixture bridges without probe methods continue to work normally", async ({
  page,
}) => {
  await mount(page);
  await expect(page.locator(".todojo")).toBeVisible();
  await expect(page.locator(".todojo__brand")).toContainText("LIVE TASKS");
  // Probe controls should not be rendered if bridge has no probe methods
  await expect(page.locator(".todojo__probe-button")).toHaveCount(0);
});
