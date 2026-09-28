import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "@playwright/test";

test("built UI renders and updates from the real stdio MCP and persisted SQLite plan", async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), "todojo-ui-stdio-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/todojo-mcp.mjs")],
    env: { ...process.env, TODOJO_DB_PATH: join(directory, "todojo.sqlite") },
    stderr: "pipe",
  });
  const client = new Client({
    name: "todojo-ui-integration",
    version: "0.1.0",
  });
  await client.connect(transport);
  try {
    const created = await client.callTool({
      name: "create_task_plan",
      arguments: {
        title: "Persisted original",
        tasks: [{ title: "Stored task" }, { title: "Next stored task" }],
      },
    });
    const planId = (created.structuredContent as { plan_id: string }).plan_id;
    const other = await client.callTool({
      name: "create_task_plan",
      arguments: {
        title: "Other plan",
        tasks: [{ title: "Other task" }],
        start_first: true,
      },
    });
    const otherPlan = other.structuredContent as { plan_id: string };
    const rendered = await client.callTool({
      name: "render_todojo",
      arguments: { plan_id: planId },
    });
    expect((rendered.structuredContent as { plan_id: string }).plan_id).toBe(
      planId,
    );
    for (const field of ["tasks", "version", "current_task_id", "status"]) {
      expect(rendered.structuredContent?.[field]).toEqual(
        created.structuredContent?.[field],
      );
    }
    // The create result alone supplies the first mounted snapshot.
    const initial = created.structuredContent as { plan_id: string };
    expect(initial.plan_id).toBe(planId);
    const resource = await client.readResource({
      uri: "ui://todojo/v0.2/todojo.html",
    });
    const html = (resource.contents[0] as { text: string }).text;
    expect(html).toContain("<script>");
    expect(html).not.toContain(resolve("web/src"));

    // The browser bridge is bound to the actual Node MCP client. Every
    // getPlan request crosses stdio and reads the SQLite-backed server.
    const requestedIds: string[] = [];
    await page.exposeBinding(
      "__todojoGetPlan",
      async (_source, requestedId: string) => {
        requestedIds.push(requestedId);
        const result = await client.callTool({
          name: "get_task_plan",
          arguments: { plan_id: requestedId },
        });
        return result.structuredContent;
      },
    );
    await page.addInitScript((snapshot) => {
      let listener: ((value: unknown) => void) | undefined;
      (
        window as unknown as { __TODOJO_TEST_BRIDGE__: unknown }
      ).__TODOJO_TEST_BRIDGE__ = {
        connect: async () => listener?.({ structuredContent: snapshot }),
        onToolResult: (next: (value: unknown) => void) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        getPlan: (requestedId: string) =>
          (
            window as unknown as {
              __todojoGetPlan: (planId: string) => Promise<unknown>;
            }
          ).__todojoGetPlan(requestedId),
      };
      (
        window as unknown as { __todojoToolResult: (plan: unknown) => void }
      ).__todojoToolResult = (plan) => {
        listener?.({ structuredContent: plan });
      };
    }, initial);
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await expect(page.getByText("Persisted original")).toBeVisible();
    await expect(page.locator(".todojo__card--active")).toContainText(
      "Stored task",
    );
    await expect(page.locator("[data-work-timer]")).toContainText("WORK 0:0");

    // An unrelated tool result cannot rebind an already mounted widget.
    await page.evaluate((snapshot) => {
      (
        window as unknown as { __todojoToolResult: (plan: unknown) => void }
      ).__todojoToolResult(snapshot);
    }, otherPlan);
    await expect(page.getByText("Persisted original")).toBeVisible();
    await expect(page.getByText("Other plan")).toHaveCount(0);

    await client.callTool({
      name: "advance_task",
      arguments: {
        plan_id: planId,
        complete_task_id: "T1",
        start_task_id: "T2",
      },
    });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator(".todojo__card--active")).toContainText(
      "Next stored task",
    );
    expect(requestedIds.length).toBeGreaterThan(0);
    expect(requestedIds.every((id) => id === planId)).toBe(true);

    // Historical remount keeps the render result's exact plan binding.
    await page.reload();
    await expect(page.getByText("Persisted original")).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator(".todojo__card--active")).toContainText(
      "Next stored task",
    );
    expect(requestedIds.every((id) => id === planId)).toBe(true);
  } finally {
    await client.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
