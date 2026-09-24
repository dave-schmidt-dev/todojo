import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { TodojoError } from "../server/src/model.ts";
import {
  resolveDatabasePath,
  SQLiteTaskPlanRepository,
} from "../server/src/sqlite-store.ts";

const directory = mkdtempSync(join(tmpdir(), "todojo-persistence-"));
after(() => rmSync(directory, { recursive: true, force: true }));

test("SQLite survives restart and configures WAL with a bounded busy timeout", () => {
  const path = join(directory, "persist.sqlite");
  const first = new SQLiteTaskPlanRepository({
    dbPath: path,
    busyTimeoutMs: 17,
  });
  const plan = first.createPlan({
    tasks: [{ title: "persist" }],
    start_first: true,
  });
  assert.equal(first.getPlan(plan.plan_id).tasks[0].display_id, "T1");
  assert.deepEqual(first.storageSettings(), {
    journalMode: "wal",
    busyTimeoutMs: 17,
  });
  first.close();
  const second = new SQLiteTaskPlanRepository({ dbPath: path });
  const restored = second.getPlan(plan.plan_id);
  assert.equal(restored.tasks[0].intervals.length, 1);
  assert.equal(restored.current_task_id, plan.current_task_id);
  assert.equal(restored.tasks[0].intervals[0].ended_at, undefined);
  assert.equal(second.storageSettings().journalMode, "wal");
  second.close();
});

test("runtime paths require an absolute TODOJO_DB_PATH while development uses repo-local data", () => {
  assert.throws(
    () => resolveDatabasePath({ mode: "installed" }),
    (error: unknown) =>
      error instanceof TodojoError && error.code === "DATABASE_PATH_REQUIRED",
  );
  assert.throws(() =>
    resolveDatabasePath({ mode: "tunnel", dbPath: "relative.sqlite" }),
  );
  const development = resolveDatabasePath({ mode: "development" });
  assert.ok(development.endsWith("/.data/todojo.sqlite"));
  assert.equal(
    resolveDatabasePath({
      mode: "installed",
      dbPath: join(directory, "configured.sqlite"),
    }),
    join(directory, "configured.sqlite"),
  );
});
