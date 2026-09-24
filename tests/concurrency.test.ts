import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { SQLiteTaskPlanRepository } from "../server/src/sqlite-store.ts";

const directory = mkdtempSync(join(tmpdir(), "todojo-concurrency-"));
after(() => rmSync(directory, { recursive: true, force: true }));

function runProcess(program: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      program,
      ...args,
    ]);
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`child exited ${code}`));
    });
  });
}

test("separate processes race to activate work and one loses without changing the version", async () => {
  const path = join(directory, "race.sqlite");
  const store = new SQLiteTaskPlanRepository({ dbPath: path });
  const plan = store.createPlan({
    tasks: [{ title: "one" }, { title: "two" }],
  });
  const moduleUrl = new URL("../server/src/sqlite-store.ts", import.meta.url)
    .href;
  const program = `import { SQLiteTaskPlanRepository } from ${JSON.stringify(moduleUrl)}; const store = new SQLiteTaskPlanRepository({ dbPath: process.argv[1] }); try { store.startTask(process.argv[2], process.argv[3]); console.log('ok'); } catch (error) { console.log(error.code); } finally { store.close(); }`;
  const runs = await Promise.all(
    ["T1", "T2"].map((task) => runProcess(program, [path, plan.plan_id, task])),
  );
  assert.equal(runs.filter((value) => value === "ok").length, 1);
  const snapshot = store.getPlan(plan.plan_id);
  assert.equal(snapshot.version, plan.version + 1);
  assert.equal(
    snapshot.tasks.filter((task) => task.status === "active").length,
    1,
  );
  store.close();
});
