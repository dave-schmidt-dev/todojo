import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { type Clock, TodojoError } from "../server/src/model.ts";
import { SQLiteTaskPlanRepository } from "../server/src/sqlite-store.ts";

class FixedClock implements Clock {
  constructor(private value = new Date("2026-01-01T00:00:00.000Z")) {}
  now(): Date {
    return new Date(this.value);
  }
  tick(milliseconds = 1): void {
    this.value = new Date(this.value.getTime() + milliseconds);
  }
}

const directory = mkdtempSync(join(tmpdir(), "todojo-transitions-"));
after(() => rmSync(directory, { recursive: true, force: true }));

function repository(clock = new FixedClock()): SQLiteTaskPlanRepository {
  return new SQLiteTaskPlanRepository({
    dbPath: join(directory, `${Math.random()}.sqlite`),
    clock,
  });
}

test("advance transitions at one timestamp and increments version once", () => {
  const clock = new FixedClock();
  const store = repository(clock);
  const created = store.createPlan({
    tasks: [{ title: "first" }, { title: "second" }],
    start_first: true,
  });
  clock.tick(1000);
  const advanced = store.advanceTask(created.plan_id, "T1", "T2");
  assert.equal(advanced.version, created.version + 1);
  assert.equal(advanced.tasks[0].status, "completed");
  assert.equal(advanced.tasks[1].status, "active");
  assert.equal(
    advanced.tasks[0].intervals[0].ended_at,
    advanced.tasks[1].intervals[0].started_at,
  );
  store.close();
});

test("active-source errors are explicit and plan completion reopens when work is added", () => {
  const store = repository();
  const plan = store.createPlan({
    tasks: [{ title: "only" }],
    start_first: true,
  });
  const complete = store.completeTask(plan.plan_id, "T1");
  assert.equal(complete.status, "completed");
  assert.throws(
    () => store.completeTask(plan.plan_id, "T1"),
    (error: unknown) =>
      error instanceof TodojoError && error.code === "ACTIVE_SOURCE_REQUIRED",
  );
  const reopened = store.addTask(plan.plan_id, { title: "new work" });
  assert.equal(reopened.status, "active");
  assert.equal(reopened.tasks.at(-1)?.display_id, "T2");
  assert.equal(
    store.startTask(plan.plan_id, "T2").tasks.at(-1)?.status,
    "active",
  );
  store.close();
});

test("blocked work resumes through start_task and clears its block reason", () => {
  const store = repository();
  const plan = store.createPlan({
    tasks: [{ title: "blocked" }],
    start_first: true,
  });
  assert.equal(plan.current_task_id, plan.tasks[0].id);
  const blocked = store.blockTask(plan.plan_id, "T1", "waiting for access");
  assert.equal(blocked.current_task_id, plan.tasks[0].id);
  assert.equal(blocked.work_ms, 0);
  for (const action of [
    () => store.completeTask(plan.plan_id, "T1"),
    () => store.advanceTask(plan.plan_id, "T1", "T1"),
  ]) {
    assert.throws(
      action,
      (error: unknown) =>
        error instanceof TodojoError && error.message.includes("start_task"),
    );
    const unchanged = store.getPlan(plan.plan_id);
    assert.equal(unchanged.version, blocked.version);
    assert.equal(unchanged.tasks[0].status, "blocked");
    assert.equal(unchanged.current_task_id, plan.tasks[0].id);
  }
  const resumed = store.startTask(plan.plan_id, "T1");
  assert.equal(resumed.current_task_id, plan.tasks[0].id);
  assert.equal(resumed.tasks[0].status, "active");
  assert.equal(resumed.tasks[0].block_reason, undefined);
  store.close();
});

test("skipping the final nonterminal task completes a plan and adding work reopens it", () => {
  const store = repository();
  const plan = store.createPlan({ tasks: [{ title: "not needed" }] });
  const completed = store.skipTask(plan.plan_id, "T1", "superseded");
  assert.equal(completed.status, "completed");
  assert.equal(completed.tasks[0].status, "skipped");
  assert.equal(
    store.addTask(plan.plan_id, { title: "replacement" }).status,
    "active",
  );
  store.close();
});

test("full and queued-subset reorders preserve stable display IDs", () => {
  const store = repository();
  const plan = store.createPlan({
    tasks: [
      { title: "one" },
      { title: "two" },
      { title: "three" },
      { title: "four" },
    ],
  });
  const active = store.startTask(plan.plan_id, "T2");
  assert.equal(active.tasks[1].status, "active");
  const subset = store.reorderTasks(plan.plan_id, ["T3", "T1"]);
  assert.equal(subset.tasks.find((task) => task.display_id === "T2")?.order, 2);
  assert.equal(subset.tasks[1].status, "active");
  assert.deepEqual(
    subset.tasks.map((task) => task.display_id),
    ["T3", "T2", "T1", "T4"],
  );
  const full = store.reorderTasks(plan.plan_id, ["T4", "T1", "T2", "T3"]);
  assert.deepEqual(
    full.tasks.map((task) => task.display_id),
    ["T4", "T1", "T2", "T3"],
  );
  assert.throws(
    () => store.reorderTasks(plan.plan_id, ["T1", "T1"]),
    (error: unknown) =>
      error instanceof TodojoError && error.code === "INVALID_REORDER",
  );
  store.close();
});

test("add_task inserts after a named task without violating unique order", () => {
  const store = repository();
  const plan = store.createPlan({
    tasks: [{ title: "one" }, { title: "two" }, { title: "three" }],
  });
  const updated = store.addTask(plan.plan_id, { title: "inserted" }, "T1");
  assert.deepEqual(
    updated.tasks.map((task) => task.display_id),
    ["T1", "T4", "T2", "T3"],
  );
  assert.equal(updated.version, plan.version + 1);
  store.close();
});

test("current pointer distinguishes a blocked former task after later work completes", () => {
  const store = repository();
  const plan = store.createPlan({
    tasks: [{ title: "first" }, { title: "second" }],
    start_first: true,
  });
  const blocked = store.blockTask(plan.plan_id, "T1", "waiting");
  assert.equal(blocked.current_task_id, plan.tasks[0].id);
  const second = store.startTask(plan.plan_id, "T2");
  assert.equal(second.current_task_id, plan.tasks[1].id);
  const complete = store.completeTask(plan.plan_id, "T2");
  assert.equal(complete.current_task_id, undefined);
  assert.equal(complete.tasks[0].status, "blocked");
  store.close();
});

test("snapshot time and overall work include open intervals and exclude blocks", () => {
  const clock = new FixedClock();
  const store = repository(clock);
  const plan = store.createPlan({
    tasks: [{ title: "work" }],
    start_first: true,
  });
  assert.equal(plan.tasks[0].intervals[0].ended_at, undefined);
  clock.tick(2_000);
  const running = store.getPlan(plan.plan_id);
  assert.equal(running.as_of, clock.now().toISOString());
  assert.equal(running.work_ms, 2_000);
  store.blockTask(plan.plan_id, "T1", "waiting");
  clock.tick(3_000);
  assert.equal(store.getPlan(plan.plan_id).work_ms, 2_000);
  store.close();
});
