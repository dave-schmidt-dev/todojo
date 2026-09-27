import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const installedRoot = process.env.TODOJO_INSTALLED_ROOT;
const directory = mkdtempSync(join(tmpdir(), "todojo-installed-db-"));
after(() => rmSync(directory, { recursive: true, force: true }));

async function installedClient(dbPath: string): Promise<Client> {
  assert.ok(installedRoot);
  const client = new Client({
    name: "todojo-local-acceptance",
    version: "0.1.0",
  });
  await client.connect(
    new StdioClientTransport({
      command: join(installedRoot, "bin/todojo-mcp"),
      cwd: installedRoot,
      env: { PATH: process.env.PATH ?? "", TODOJO_DB_PATH: dbPath },
      stderr: "pipe",
    }),
  );
  return client;
}

function planOf(result: { structuredContent?: unknown }) {
  return result.structuredContent as {
    plan_id: string;
    status: string;
    work_ms: number;
    tasks: { display_id: string; status: string; intervals: unknown[] }[];
  };
}

test("installed MCP clients share atomic plan state across processes and restart", {
  skip: !installedRoot,
  timeout: 30_000,
}, async () => {
  assert.ok(installedRoot);
  const installedMcp = JSON.parse(
    readFileSync(join(installedRoot, "mcp.json"), "utf8"),
  ) as { mcpServers: { todojo: { env: { TODOJO_DB_PATH: string } } } };
  assert.equal(
    installedMcp.mcpServers.todojo.env.TODOJO_DB_PATH,
    join(process.cwd(), ".data/todojo.sqlite"),
  );

  const dbPath = join(directory, "acceptance.sqlite");
  const writer = await installedClient(dbPath);
  const reader = await installedClient(dbPath);
  let planId = "";
  try {
    const tools = await writer.listTools();
    assert.equal(tools.tools.length, 11);
    const created = planOf(
      await writer.callTool({
        name: "create_task_plan",
        arguments: {
          title: "Installed cross-process acceptance",
          tasks: [{ title: "first" }, { title: "second" }, { title: "third" }],
          start_first: true,
        },
      }),
    );
    planId = created.plan_id;
    assert.deepEqual(
      created.tasks.map((task) => task.display_id),
      ["T1", "T2", "T3"],
    );
    const listed = await reader.callTool({
      name: "list_task_plans",
      arguments: {},
    });
    assert.equal(
      (listed.structuredContent as { plans: { plan_id: string }[] }).plans[0]
        .plan_id,
      planId,
    );
    const fetched = planOf(
      await reader.callTool({
        name: "get_task_plan",
        arguments: { plan_id: planId },
      }),
    );
    assert.equal(fetched.tasks[0].status, "active");
    const added = planOf(
      await writer.callTool({
        name: "add_task",
        arguments: { plan_id: planId, title: "fourth" },
      }),
    );
    assert.equal(added.tasks[3].display_id, "T4");
    const fifth = planOf(
      await writer.callTool({
        name: "add_task",
        arguments: { plan_id: planId, title: "fifth" },
      }),
    );
    assert.equal(fifth.tasks[4].display_id, "T5");
    const blocked = planOf(
      await writer.callTool({
        name: "block_task",
        arguments: { plan_id: planId, task_id: "T1", reason: "external" },
      }),
    );
    assert.equal(blocked.tasks[0].status, "blocked");
    const invalid = await reader.callTool({
      name: "complete_task",
      arguments: { plan_id: planId, task_id: "T1" },
    });
    assert.equal(invalid.isError, true);
    await writer.callTool({
      name: "start_task",
      arguments: { plan_id: planId, task_id: "T1" },
    });
    const advanced = planOf(
      await writer.callTool({
        name: "advance_task",
        arguments: {
          plan_id: planId,
          complete_task_id: "T1",
          start_task_id: "T2",
        },
      }),
    );
    assert.equal(advanced.tasks[0].status, "completed");
    assert.equal(advanced.tasks[1].status, "active");
    const skipped = planOf(
      await writer.callTool({
        name: "skip_task",
        arguments: { plan_id: planId, task_id: "T3" },
      }),
    );
    assert.equal(skipped.tasks[2].status, "skipped");
    const reordered = planOf(
      await writer.callTool({
        name: "reorder_tasks",
        arguments: { plan_id: planId, ordered_task_ids: ["T5", "T4"] },
      }),
    );
    assert.deepEqual(
      reordered.tasks.map((task) => task.display_id),
      ["T1", "T2", "T3", "T5", "T4"],
    );
    const fullReorder = planOf(
      await writer.callTool({
        name: "reorder_tasks",
        arguments: {
          plan_id: planId,
          ordered_task_ids: ["T1", "T2", "T3", "T4", "T5"],
        },
      }),
    );
    assert.deepEqual(
      fullReorder.tasks.map((task) => task.display_id),
      ["T1", "T2", "T3", "T4", "T5"],
    );
    const rendered = planOf(
      await reader.callTool({
        name: "render_todojo",
        arguments: { plan_id: planId },
      }),
    );
    assert.equal(rendered.plan_id, planId);
    const completed = planOf(
      await writer.callTool({
        name: "complete_task",
        arguments: { plan_id: planId, task_id: "T2" },
      }),
    );
    assert.equal(completed.tasks[1].status, "completed");
  } finally {
    await writer.close();
    await reader.close();
  }
  const reopened = await installedClient(dbPath);
  try {
    const persisted = planOf(
      await reopened.callTool({
        name: "get_task_plan",
        arguments: { plan_id: planId },
      }),
    );
    assert.equal(persisted.tasks[0].status, "completed");
    assert.equal(persisted.tasks[1].status, "completed");
    assert.equal(persisted.tasks[2].status, "skipped");
    assert.equal(persisted.tasks[3].status, "queued");
    assert.equal(persisted.tasks[4].status, "queued");
    assert.ok(persisted.work_ms >= 0);
    assert.ok(persisted.tasks[0].intervals.length >= 2);
  } finally {
    await reopened.close();
  }
});
