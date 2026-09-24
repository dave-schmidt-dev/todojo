import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ProgressEvent } from "../server/src/progress.ts";
import { SQLiteTaskPlanRepository } from "../server/src/sqlite-store.ts";
import { statusText } from "../server/src/tools.ts";

const directory = mkdtempSync(join(tmpdir(), "todojo-progress-"));
after(() => rmSync(directory, { recursive: true, force: true }));

test("stall-prone repository calls emit pending and terminal status without stdout", () => {
  const events: ProgressEvent[] = [];
  const store = new SQLiteTaskPlanRepository({
    dbPath: join(directory, "progress.sqlite"),
  });
  const originalWrite = process.stdout.write;
  const stdout: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const plan = store.createPlan({ tasks: [{ title: "one" }] }, (event) =>
      events.push(event),
    );
    store.getPlan(plan.plan_id, (event) => events.push(event));
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.deepEqual(stdout, [], "repository progress must not write to stdout");
  assert.deepEqual(
    events.map((event) => `${event.operation}:${event.phase}`),
    [
      "create_task_plan:pending",
      "create_task_plan:result",
      "get_task_plan:pending",
      "get_task_plan:result",
    ],
  );
  assert.equal(statusText(events[0]), "todojo create_task_plan pending");
  store.close();
});

test("failed repository calls emit an error status", () => {
  const events: ProgressEvent[] = [];
  const store = new SQLiteTaskPlanRepository({
    dbPath: join(directory, "error.sqlite"),
  });
  const plan = store.createPlan({ tasks: [{ title: "one" }] });
  assert.throws(() =>
    store.completeTask(plan.plan_id, "T1", (event) => events.push(event)),
  );
  assert.deepEqual(
    events.map((event) => event.phase),
    ["pending", "error"],
  );
  store.close();
});
