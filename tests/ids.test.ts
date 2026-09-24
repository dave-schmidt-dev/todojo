import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { SQLiteTaskPlanRepository } from "../server/src/sqlite-store.ts";

const directory = mkdtempSync(join(tmpdir(), "todojo-ids-"));
after(() => rmSync(directory, { recursive: true, force: true }));

test("fifty display IDs remain stable, resolve within a plan, and never reuse skipped numbers", () => {
  const store = new SQLiteTaskPlanRepository({
    dbPath: join(directory, "ids.sqlite"),
  });
  const plan = store.createPlan({
    tasks: Array.from({ length: 50 }, (_, index) => ({
      title: `task ${index + 1}`,
    })),
  });
  assert.deepEqual(
    plan.tasks.map((task) => task.display_id),
    Array.from({ length: 50 }, (_, index) => `T${index + 1}`),
  );
  const skipped = store.skipTask(plan.plan_id, "T7");
  assert.equal(skipped.tasks[6].status, "skipped");
  const added = store.addTask(plan.plan_id, { title: "fifty one" });
  assert.equal(added.tasks.at(-1)?.display_id, "T51");
  const byNumber = store.startTask(plan.plan_id, "T1");
  assert.equal(byNumber.tasks[0].status, "active");
  store.close();
});

test("a T-number and UUID resolve only inside their own plan", () => {
  const store = new SQLiteTaskPlanRepository({
    dbPath: join(directory, "plan-scoped-ids.sqlite"),
  });
  const first = store.createPlan({ tasks: [{ title: "one" }] });
  const second = store.createPlan({ tasks: [{ title: "two" }] });
  assert.throws(() => store.startTask(first.plan_id, second.tasks[0].id));
  assert.equal(store.getPlan(first.plan_id).version, first.version);
  assert.equal(
    store.startTask(second.plan_id, "T1").tasks[0].id,
    second.tasks[0].id,
  );
  store.close();
});
