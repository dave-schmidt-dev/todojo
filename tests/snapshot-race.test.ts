import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { SQLiteTaskPlanRepository } from "../server/src/sqlite-store.ts";

const directory = mkdtempSync(join(tmpdir(), "todojo-snapshot-"));
after(() => rmSync(directory, { recursive: true, force: true }));

function addTasksInChild(
  path: string,
  planId: string,
  moduleUrl: string,
): { ready: Promise<void>; done: Promise<void> } {
  const program = `import { SQLiteTaskPlanRepository } from ${JSON.stringify(moduleUrl)}; const store = new SQLiteTaskPlanRepository({ dbPath: process.argv[1] }); console.log('READY'); for (let i = 0; i < 30; i += 1) { store.addTask(process.argv[2], { title: 'child ' + i }); await new Promise((resolve) => setTimeout(resolve, 5)); } store.close();`;
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    program,
    path,
    planId,
  ]);
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.once("data", (chunk: Buffer) => {
      if (String(chunk).includes("READY")) resolve();
      else reject(new Error("writer did not report readiness"));
    });
    child.once("error", reject);
  });
  const done = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`child exited ${code}`));
    });
  });
  return { ready, done };
}

test("snapshots observe one committed version while another process writes", async () => {
  const path = join(directory, "snapshot.sqlite");
  const writer = new SQLiteTaskPlanRepository({ dbPath: path });
  const reader = new SQLiteTaskPlanRepository({ dbPath: path });
  const plan = writer.createPlan({ tasks: [{ title: "one" }] });
  const child = addTasksInChild(
    path,
    plan.plan_id,
    new URL("../server/src/sqlite-store.ts", import.meta.url).href,
  );
  await child.ready;
  const seenVersions = new Set<number>();
  for (let index = 0; index < 50; index += 1) {
    const snapshot = reader.getPlan(plan.plan_id);
    assert.equal(snapshot.tasks.length, snapshot.next_task_number - 1);
    assert.equal(snapshot.version, snapshot.tasks.length);
    seenVersions.add(snapshot.version);
    await delay(2);
  }
  await child.done;
  assert.ok(seenVersions.size > 1, "reader overlapped the live writer");
  assert.equal(reader.getPlan(plan.plan_id).tasks.length, 31);
  writer.close();
  reader.close();
});
