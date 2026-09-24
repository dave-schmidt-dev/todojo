import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Clock } from "../server/src/model.ts";
import { SQLiteTaskPlanRepository } from "../server/src/sqlite-store.ts";
import { taskDurationMs } from "../server/src/timers.ts";

class ClockAt implements Clock {
  constructor(private value: Date) {}
  now(): Date {
    return new Date(this.value);
  }
  advance(ms: number): void {
    this.value = new Date(this.value.getTime() + ms);
  }
}

const directory = mkdtempSync(join(tmpdir(), "todojo-timers-"));
after(() => rmSync(directory, { recursive: true, force: true }));

test("persisted intervals exclude blocked time and use the injected clock", () => {
  const clock = new ClockAt(new Date("2026-01-01T00:00:00.000Z"));
  const path = join(directory, "timer.sqlite");
  const store = new SQLiteTaskPlanRepository({ dbPath: path, clock });
  const plan = store.createPlan({
    tasks: [{ title: "work" }],
    start_first: true,
  });
  clock.advance(1000);
  store.blockTask(plan.plan_id, "T1", "dependency");
  clock.advance(3000);
  store.startTask(plan.plan_id, "T1");
  clock.advance(2000);
  const done = store.completeTask(plan.plan_id, "T1");
  assert.equal(taskDurationMs(done.tasks[0].intervals, clock), 3000);
  store.close();
  const reopened = new SQLiteTaskPlanRepository({ dbPath: path, clock });
  assert.equal(
    taskDurationMs(reopened.getPlan(plan.plan_id).tasks[0].intervals, clock),
    3000,
  );
  reopened.close();
});
