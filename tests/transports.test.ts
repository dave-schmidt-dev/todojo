import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createTodojoServer } from "../server/src/index.ts";
import { TODOJO_RESOURCE_URI } from "../server/src/resource.ts";

const directory = mkdtempSync(join(tmpdir(), "todojo-transport-"));
after(() => rmSync(directory, { recursive: true, force: true }));

test("creation and recovery mount the same resource; transitions never remount", async () => {
  const { server, repository } = createTodojoServer({
    store: { dbPath: join(directory, "data.sqlite") },
  });
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "todojo-test", version: "0.1.0" });
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
    for (const name of ["list_task_plans", "get_task_plan"]) {
      const tool = byName.get(name);
      assert.equal(
        tool?.annotations?.readOnlyHint,
        true,
        `${name} must be read-only`,
      );
      assert.deepEqual(
        (tool?._meta as { ui?: { visibility?: string[] } } | undefined)?.ui
          ?.visibility,
        ["model", "app"],
        `${name} must be available to the model and widget`,
      );
    }
    for (const name of [
      "create_task_plan",
      "add_task",
      "start_task",
      "complete_task",
      "advance_task",
      "block_task",
      "skip_task",
      "reorder_tasks",
    ]) {
      const tool = byName.get(name);
      assert.deepEqual(
        (tool?._meta as { ui?: { visibility?: string[] } } | undefined)?.ui
          ?.visibility,
        ["model"],
        `${name} must be model-only`,
      );
    }
    for (const [name, phrase] of [
      ["create_task_plan", "substantial multi-step work"],
      ["start_task", "resume blocked work"],
      ["complete_task", "Resume blocked work"],
      ["advance_task", "blocked work must be resumed"],
      ["reorder_tasks", "queued subsets"],
      ["render_todojo", "exactly one"],
    ]) {
      assert.match(byName.get(name)?.description ?? "", new RegExp(phrase));
    }
    const rendered = byName.get("render_todojo");
    assert.equal(rendered?.annotations?.readOnlyHint, true);
    assert.equal(
      (rendered?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui
        ?.resourceUri,
      TODOJO_RESOURCE_URI,
    );
    assert.equal(
      tools.tools.filter(
        (tool) =>
          (tool._meta as { ui?: { resourceUri?: string } } | undefined)?.ui
            ?.resourceUri,
      ).length,
      2,
    );
    assert.equal(
      (
        byName.get("create_task_plan")?._meta as
          | { ui?: { resourceUri?: string } }
          | undefined
      )?.ui?.resourceUri,
      TODOJO_RESOURCE_URI,
    );
    for (const tool of tools.tools) {
      if (tool.name === "create_task_plan" || tool.name === "render_todojo")
        continue;
      assert.equal(
        (tool._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri,
        undefined,
      );
    }
    const one = await client.callTool({
      name: "create_task_plan",
      arguments: { tasks: [{ title: "one" }] },
    });
    const two = await client.callTool({
      name: "create_task_plan",
      arguments: { tasks: [{ title: "two" }] },
    });
    const first = (one.structuredContent as { plan_id: string }).plan_id;
    const second = (two.structuredContent as { plan_id: string }).plan_id;
    const output = await client.callTool({
      name: "render_todojo",
      arguments: { plan_id: second },
    });
    assert.equal(
      (output.structuredContent as { plan_id: string }).plan_id,
      second,
    );
    assert.notEqual(
      (output.structuredContent as { plan_id: string }).plan_id,
      first,
    );
    assert.deepEqual(
      output.structuredContent?.tasks,
      repository.getPlan(second).tasks,
    );
    assert.equal(
      output.structuredContent?.version,
      repository.getPlan(second).version,
    );
    assert.equal(repository.getPlan(first).tasks[0].status, "active");
    assert.equal(repository.getPlan(second).tasks[0].status, "active");
    const transitioned = await client.callTool({
      name: "complete_task",
      arguments: { plan_id: first, task_id: "T1" },
    });
    assert.equal(
      (transitioned.structuredContent as { status: string }).status,
      "completed",
    );
    assert.equal(
      (transitioned._meta as { ui?: { resourceUri?: string } })?.ui
        ?.resourceUri,
      undefined,
    );
    const resource = await client.readResource({ uri: TODOJO_RESOURCE_URI });
    assert.match((resource.contents[0] as { text: string }).text, /<main/);
    assert.deepEqual(resource.contents[0]._meta?.["openai/ui"], {
      availableDisplayModes: ["inline"],
    });
  } finally {
    await client.close();
    repository.close();
    await server.close();
  }
});

test("MCP host receives pending and result status before the tool response", async () => {
  const { server, repository } = createTodojoServer({
    store: { dbPath: join(directory, "status.sqlite") },
  });
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "todojo-status-test", version: "0.1.0" });
  const timeline: string[] = [];
  client.setNotificationHandler("notifications/message", (notification) => {
    timeline.push(String(notification.params.data));
  });
  await client.connect(clientTransport);
  try {
    await client.callTool({
      name: "create_task_plan",
      arguments: { tasks: [{ title: "status" }] },
    });
    timeline.push("response");
    assert.ok(
      timeline.some((entry) => entry.includes("create_task_plan pending")),
    );
    assert.ok(
      timeline.some((entry) => entry.includes("create_task_plan result")),
    );
    assert.ok(
      timeline.findIndex((entry) => entry.includes("pending")) <
        timeline.indexOf("response"),
    );
  } finally {
    await client.close();
    repository.close();
    await server.close();
  }
});
