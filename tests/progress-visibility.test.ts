import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ProgressEvent } from "../server/src/progress.ts";
import { SQLiteTaskPlanRepository } from "../server/src/sqlite-store.ts";

const directory = mkdtempSync(join(tmpdir(), "todojo-progress-"));
after(() => rmSync(directory, { recursive: true, force: true }));

test("stall-prone repository calls emit pending and terminal status without stdout", () => {
  const events: ProgressEvent[] = [];
  const store = new SQLiteTaskPlanRepository({
    dbPath: join(directory, "progress.sqlite"),
  });
  const plan = store.createPlan({ tasks: [{ title: "one" }] }, (event) =>
    events.push(event),
  );
  store.getPlan(plan.plan_id, (event) => events.push(event));
  assert.deepEqual(
    events.map((event) => `${event.operation}:${event.phase}`),
    [
      "create_task_plan:pending",
      "create_task_plan:result",
      "get_task_plan:pending",
      "get_task_plan:result",
    ],
  );
  store.close();
});

test("failed repository calls emit an error status and write nothing to stdout", () => {
  const events: ProgressEvent[] = [];
  const writes: string[] = [];
  const store = new SQLiteTaskPlanRepository({
    dbPath: join(directory, "error-progress.sqlite"),
  });
  const plan = store.createPlan({ tasks: [{ title: "one" }] });
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
    );
    return true;
  }) as typeof process.stdout.write;
  try {
    assert.throws(() =>
      store.completeTask(plan.plan_id, "T1", (event) => events.push(event)),
    );
  } finally {
    process.stdout.write = originalWrite;
    store.close();
  }
  assert.deepEqual(
    events.map((event) => event.phase),
    ["pending", "error"],
  );
  assert.match(events[1].error ?? "", /active source/);
  assert.deepEqual(writes, []);
});
