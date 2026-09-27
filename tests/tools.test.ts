import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createTodojoServer } from "../server/src/index.ts";

const directory = mkdtempSync(join(tmpdir(), "todojo-tools-"));
after(() => rmSync(directory, { recursive: true, force: true }));

async function connected(name: string) {
  const { server, repository } = createTodojoServer({
    store: { dbPath: join(directory, `${name}.sqlite`) },
  });
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "todojo-test", version: "0.1.0" });
  await client.connect(clientTransport);
  return { client, server, repository };
}

test("packet tools return authoritative structured snapshots and enforce transitions", async () => {
  const { client, server, repository } = await connected("packet");
  try {
    const created = await client.callTool({
      name: "create_task_plan",
      arguments: {
        title: "Plan",
        tasks: [{ title: "one" }, { title: "two" }],
        start_first: true,
      },
    });
    const plan = created.structuredContent as {
      plan_id: string;
      tasks: { id: string; status: string; display_id: string }[];
    };
    assert.equal(plan.tasks[0].status, "active");
    const advertised = await client.listTools();
    assert.equal(
      advertised.tools.filter((tool) => tool.outputSchema !== undefined).length,
      11,
    );
    const listed = await client.callTool({
      name: "list_task_plans",
      arguments: {},
    });
    assert.equal(
      (listed.structuredContent as { plans: unknown[] }).plans.length,
      1,
    );
    const fetched = await client.callTool({
      name: "get_task_plan",
      arguments: { plan_id: plan.plan_id },
    });
    assert.equal(
      (fetched.structuredContent as { plan_id: string }).plan_id,
      plan.plan_id,
    );
    const added = await client.callTool({
      name: "add_task",
      arguments: {
        plan_id: plan.plan_id,
        title: "three",
        after_task_id: "T2",
      },
    });
    assert.equal(
      (added.structuredContent as { tasks: unknown[] }).tasks.length,
      3,
    );
    const duplicateStart = await client.callTool({
      name: "start_task",
      arguments: { plan_id: plan.plan_id, task_id: "T2" },
    });
    assert.equal(duplicateStart.isError, true);
    const advanced = await client.callTool({
      name: "advance_task",
      arguments: {
        plan_id: plan.plan_id,
        complete_task_id: "T1",
        start_task_id: "T2",
      },
    });
    assert.equal(
      (advanced.structuredContent as { tasks: { status: string }[] }).tasks[1]
        .status,
      "active",
    );
    await client.callTool({
      name: "block_task",
      arguments: { plan_id: plan.plan_id, task_id: "T2", reason: "access" },
    });
    const blockedCompletion = await client.callTool({
      name: "complete_task",
      arguments: { plan_id: plan.plan_id, task_id: "T2" },
    });
    assert.equal(blockedCompletion.isError, true);
    const resumed = await client.callTool({
      name: "start_task",
      arguments: { plan_id: plan.plan_id, task_id: "T2" },
    });
    assert.equal(
      (resumed.structuredContent as { tasks: { block_reason?: string }[] })
        .tasks[1].block_reason,
      undefined,
    );
    const completed = await client.callTool({
      name: "complete_task",
      arguments: { plan_id: plan.plan_id, task_id: "T2" },
    });
    assert.equal(
      (completed.structuredContent as { tasks: { status: string }[] }).tasks[1]
        .status,
      "completed",
    );
    const skipped = await client.callTool({
      name: "skip_task",
      arguments: {
        plan_id: plan.plan_id,
        task_id: "T3",
        reason: "not needed",
      },
    });
    assert.equal(
      (skipped.structuredContent as { tasks: { status: string }[] }).tasks[2]
        .status,
      "skipped",
    );
  } finally {
    await client.close();
    repository.close();
    await server.close();
  }
});

test("reorder tool preserves full and queued-subset behavior", async () => {
  const { client, server, repository } = await connected("reorder");
  try {
    const created = await client.callTool({
      name: "create_task_plan",
      arguments: {
        tasks: [{ title: "one" }, { title: "two" }, { title: "three" }],
      },
    });
    const plan = created.structuredContent as { plan_id: string };
    const subset = await client.callTool({
      name: "reorder_tasks",
      arguments: { plan_id: plan.plan_id, ordered_task_ids: ["T3", "T1"] },
    });
    assert.deepEqual(
      (
        subset.structuredContent as { tasks: { display_id: string }[] }
      ).tasks.map((task) => task.display_id),
      ["T3", "T2", "T1"],
    );
    const full = await client.callTool({
      name: "reorder_tasks",
      arguments: {
        plan_id: plan.plan_id,
        ordered_task_ids: ["T2", "T1", "T3"],
      },
    });
    assert.deepEqual(
      (full.structuredContent as { tasks: { display_id: string }[] }).tasks.map(
        (task) => task.display_id,
      ),
      ["T2", "T1", "T3"],
    );
  } finally {
    await client.close();
    repository.close();
    await server.close();
  }
});

test("reorder tool supports a full plan grown beyond the create limit", async () => {
  const { client, server, repository } = await connected("large-reorder");
  try {
    const created = await client.callTool({
      name: "create_task_plan",
      arguments: {
        tasks: Array.from({ length: 100 }, (_, index) => ({
          title: `task ${index + 1}`,
        })),
      },
    });
    const plan = created.structuredContent as { plan_id: string };
    const added = await client.callTool({
      name: "add_task",
      arguments: { plan_id: plan.plan_id, title: "task 101" },
    });
    const taskIds = (
      added.structuredContent as { tasks: { display_id: string }[] }
    ).tasks.map((task) => task.display_id);
    assert.equal(taskIds.at(-1), "T101");

    const reordered = await client.callTool({
      name: "reorder_tasks",
      arguments: {
        plan_id: plan.plan_id,
        ordered_task_ids: [...taskIds].reverse(),
      },
    });
    assert.deepEqual(
      (
        reordered.structuredContent as { tasks: { display_id: string }[] }
      ).tasks.map((task) => task.display_id),
      [...taskIds].reverse(),
    );
  } finally {
    await client.close();
    repository.close();
    await server.close();
  }
});
