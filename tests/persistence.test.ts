import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { createTodojoServer } from "../server/src/index.ts";
import { TodojoError } from "../server/src/model.ts";
import {
  resolveDatabasePath,
  SQLiteTaskPlanRepository,
} from "../server/src/sqlite-store.ts";

const directory = mkdtempSync(join(tmpdir(), "todojo-persistence-"));
after(() => rmSync(directory, { recursive: true, force: true }));

function backupPaths(path: string): string[] {
  return readdirSync(dirname(path))
    .filter(
      (entry) =>
        entry.startsWith(`${basename(path)}.pre-v1-`) &&
        entry.endsWith(".sqlite"),
    )
    .map((entry) => join(dirname(path), entry));
}

function legacyDatabase(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE plans (
      id TEXT PRIMARY KEY, title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      version INTEGER NOT NULL, next_task_number INTEGER NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, display_id TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT, task_order INTEGER NOT NULL, status TEXT NOT NULL,
      block_reason TEXT, created_at TEXT NOT NULL, completed_at TEXT, skipped_at TEXT,
      UNIQUE(plan_id, display_id), UNIQUE(plan_id, task_order)
    );
    CREATE TABLE intervals (
      id INTEGER PRIMARY KEY, task_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT
    );
  `);
  return database;
}

function databaseVersion(path: string): number {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return (
      database.prepare("PRAGMA user_version").get() as {
        user_version: number;
      }
    ).user_version;
  } finally {
    database.close();
  }
}

function journalMode(path: string): string {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return (
      database.prepare("PRAGMA journal_mode").get() as {
        journal_mode: string;
      }
    ).journal_mode;
  } finally {
    database.close();
  }
}

function assertValidLegacyBackup(path: string): void {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(
      (
        database.prepare("PRAGMA integrity_check").get() as {
          integrity_check: string;
        }
      ).integrity_check,
      "ok",
    );
    assert.equal(databaseVersion(path), 0);
    const columns = database.prepare("PRAGMA table_info(plans)").all() as {
      name: string;
    }[];
    assert.equal(
      columns.some((column) => column.name === "current_task_id"),
      false,
    );
  } finally {
    database.close();
  }
}

function startRepository(
  path: string,
): Promise<{ code: number | null; stderr: string }> {
  const source = resolve("server/src/sqlite-store.ts");
  const program = `import { SQLiteTaskPlanRepository } from ${JSON.stringify(source)};\nconst repository = new SQLiteTaskPlanRepository({ dbPath: process.argv[1] });\nrepository.close();`;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", program, path],
      { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolvePromise({ code, stderr }));
  });
}

function startRepositoryWithMigrationStatus(path: string): {
  phases: string[];
  finished: Promise<{ code: number | null; stderr: string }>;
  waitForPhase: (phase: "pending" | "result" | "error") => Promise<void>;
} {
  const source = resolve("server/src/sqlite-store.ts");
  const program = `import { SQLiteTaskPlanRepository } from ${JSON.stringify(source)};
const repository = new SQLiteTaskPlanRepository({
  dbPath: process.argv[1],
  onMigrationStatus: ({ phase }) => process.stderr.write(phase + "\\n"),
});
repository.close();`;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", program, path],
    { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"] },
  );
  const phases: string[] = [];
  const waiters = new Map<string, (() => void)[]>();
  let pendingLine = "";
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    const lines = `${pendingLine}${chunk}`.split("\n");
    pendingLine = lines.pop() ?? "";
    for (const line of lines) {
      if (line !== "pending" && line !== "result" && line !== "error") continue;
      phases.push(line);
      const callbacks = waiters.get(line) ?? [];
      waiters.delete(line);
      callbacks.forEach((callback) => {
        callback();
      });
    }
  });
  const finished = new Promise<{ code: number | null; stderr: string }>(
    (resolvePromise, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        resolvePromise({ code, stderr });
      });
    },
  );
  return {
    phases,
    finished,
    waitForPhase: (phase) => {
      if (phases.includes(phase)) return Promise.resolve();
      return new Promise((resolvePromise, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`timed out waiting for migration ${phase}`));
        }, 5_000);
        const resolveWhenReported = () => {
          clearTimeout(timeout);
          resolvePromise();
        };
        const rejectOnExit = () => {
          clearTimeout(timeout);
          reject(
            new Error(`repository exited before reporting migration ${phase}`),
          );
        };
        const callbacks = waiters.get(phase) ?? [];
        callbacks.push(resolveWhenReported);
        waiters.set(phase, callbacks);
        child.once("close", rejectOnExit);
        child.once("error", rejectOnExit);
      });
    },
  };
}

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

test("unversioned migration makes one validated legacy backup and backfills current work", () => {
  const path = join(directory, "legacy-current-task.sqlite");
  const database = legacyDatabase(path);
  const createdAt = "2026-09-24T12:00:00.000Z";
  database
    .prepare("INSERT INTO plans VALUES (?, NULL, ?, ?, 1, 4, 'active')")
    .run("blocked-only", createdAt, createdAt);
  database
    .prepare("INSERT INTO plans VALUES (?, NULL, ?, ?, 1, 4, 'active')")
    .run("ambiguous", createdAt, createdAt);
  const addTask = database.prepare(
    "INSERT INTO tasks VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?, NULL, NULL)",
  );
  addTask.run(
    "blocked-only-T2",
    "blocked-only",
    "T2",
    "blocked",
    2,
    "blocked",
    createdAt,
  );
  addTask.run(
    "ambiguous-blocked",
    "ambiguous",
    "T1",
    "blocked",
    1,
    "blocked",
    createdAt,
  );
  addTask.run(
    "ambiguous-active",
    "ambiguous",
    "T2",
    "active",
    2,
    "active",
    createdAt,
  );
  addTask.run(
    "ambiguous-active-later",
    "ambiguous",
    "T3",
    "active",
    3,
    "active",
    createdAt,
  );
  database.close();

  const repository = new SQLiteTaskPlanRepository({ dbPath: path });
  try {
    assert.equal(
      repository.getPlan("blocked-only").current_task_id,
      "blocked-only-T2",
    );
    // Active beats blocked; ties use the lowest legacy task order.
    assert.equal(
      repository.getPlan("ambiguous").current_task_id,
      "ambiguous-active",
    );
    assert.equal(databaseVersion(path), 1);
  } finally {
    repository.close();
  }
  const backups = backupPaths(path);
  assert.equal(backups.length, 1);
  assertValidLegacyBackup(backups[0]);
  const restarted = new SQLiteTaskPlanRepository({ dbPath: path });
  restarted.close();
  assert.equal(backupPaths(path).length, 1);
});

test("fresh SQLite databases become v1 without a backup", () => {
  const path = join(directory, "fresh-v1.sqlite");
  const repository = new SQLiteTaskPlanRepository({ dbPath: path });
  repository.close();
  assert.equal(databaseVersion(path), 1);
  assert.deepEqual(backupPaths(path), []);
});

test("future SQLite versions reject without schema or version mutation", () => {
  const path = join(directory, "future.sqlite");
  const database = new DatabaseSync(path);
  database.exec(
    "CREATE TABLE preserved (id INTEGER PRIMARY KEY); PRAGMA user_version = 2;",
  );
  database.close();
  const bytesBefore = readFileSync(path);
  const journalBefore = journalMode(path);
  assert.throws(
    () => new SQLiteTaskPlanRepository({ dbPath: path }),
    /schema version is newer/,
  );
  const check = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(databaseVersion(path), 2);
    assert.match(
      (
        check
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'preserved'",
          )
          .get() as { sql: string }
      ).sql,
      /CREATE TABLE preserved/,
    );
  } finally {
    check.close();
  }
  assert.deepEqual(backupPaths(path), []);
  assert.deepEqual(readFileSync(path), bytesBefore);
  assert.equal(journalMode(path), journalBefore);
});

test("a failed migration rolls back schema and version, retains its backup, and can retry", () => {
  const path = join(directory, "failed-migration.sqlite");
  const database = legacyDatabase(path);
  const timestamp = "2026-09-24T12:00:00.000Z";
  database
    .prepare("INSERT INTO plans VALUES (?, NULL, ?, ?, 1, 2, 'active')")
    .run("plan", timestamp, timestamp);
  database
    .prepare(
      "INSERT INTO tasks VALUES (?, ?, 'T1', 'blocked', NULL, 1, 'blocked', NULL, ?, NULL, NULL)",
    )
    .run("task", "plan", timestamp);
  database.exec(`
    CREATE TRIGGER reject_legacy_backfill BEFORE UPDATE ON plans
    BEGIN SELECT RAISE(ABORT, 'injected migration failure'); END;
  `);
  database.close();

  assert.throws(
    () => new SQLiteTaskPlanRepository({ dbPath: path }),
    /injected migration failure/,
  );
  assert.equal(databaseVersion(path), 0);
  const beforeRetry = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(
      (
        beforeRetry.prepare("PRAGMA table_info(plans)").all() as {
          name: string;
        }[]
      ).some((column) => column.name === "current_task_id"),
      false,
    );
  } finally {
    beforeRetry.close();
  }
  const backups = backupPaths(path);
  assert.equal(backups.length, 1);
  const failedMigrationBackup = backups[0];
  assertValidLegacyBackup(failedMigrationBackup);

  const repair = new DatabaseSync(path);
  repair
    .prepare(
      "INSERT INTO tasks VALUES (?, ?, 'T2', 'changed after failure', NULL, 2, 'queued', NULL, ?, NULL, NULL)",
    )
    .run("changed-task", "plan", timestamp);
  repair.exec("DROP TRIGGER reject_legacy_backfill");
  repair.close();
  const repository = new SQLiteTaskPlanRepository({ dbPath: path });
  try {
    assert.equal(repository.getPlan("plan").current_task_id, "task");
  } finally {
    repository.close();
  }
  assert.equal(databaseVersion(path), 1);
  const retryBackups = backupPaths(path);
  assert.equal(retryBackups.length, 2);
  const retryBackup = retryBackups.find(
    (backup) => backup !== failedMigrationBackup,
  );
  assert.ok(retryBackup);
  assertValidLegacyBackup(retryBackup);
  const snapshot = new DatabaseSync(retryBackup, { readOnly: true });
  try {
    assert.equal(
      (
        snapshot
          .prepare("SELECT title FROM tasks WHERE id = 'changed-task'")
          .get() as { title: string }
      ).title,
      "changed after failure",
    );
  } finally {
    snapshot.close();
  }
});

test("the source write lock covers the backup-to-migration gap and concurrent starters make one backup", async () => {
  const lockedPath = join(directory, "locked-gap.sqlite");
  const lockedFixture = legacyDatabase(lockedPath);
  lockedFixture.close();
  let writeRejected = false;
  const repository = new SQLiteTaskPlanRepository({
    dbPath: lockedPath,
    onMigrationBackupReady: () => {
      const writer = new DatabaseSync(lockedPath);
      try {
        writer.exec("PRAGMA busy_timeout = 0");
        assert.throws(
          () => writer.exec("BEGIN IMMEDIATE"),
          /database is locked/,
        );
        writeRejected = true;
      } finally {
        writer.close();
      }
    },
  });
  repository.close();
  assert.equal(writeRejected, true);
  assert.equal(databaseVersion(lockedPath), 1);
  assert.equal(backupPaths(lockedPath).length, 1);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const concurrentPath = join(directory, `concurrent-${attempt}.sqlite`);
    const concurrentFixture = legacyDatabase(concurrentPath);
    concurrentFixture.close();
    const starters = await Promise.all([
      startRepository(concurrentPath),
      startRepository(concurrentPath),
    ]);
    assert.deepEqual(starters, [
      { code: 0, stderr: "" },
      { code: 0, stderr: "" },
    ]);
    assert.equal(databaseVersion(concurrentPath), 1);
    assert.equal(journalMode(concurrentPath), "wal");
    assert.equal(backupPaths(concurrentPath).length, 1);
  }
});

test("startup reports pending before a v1 source write-lock wait", async () => {
  const path = join(directory, "startup-v1-lock.sqlite");
  const fixture = new SQLiteTaskPlanRepository({ dbPath: path });
  fixture.close();
  const sourceWriter = new DatabaseSync(path);
  sourceWriter.exec("BEGIN IMMEDIATE");
  const starter = startRepositoryWithMigrationStatus(path);
  try {
    await starter.waitForPhase("pending");
    assert.deepEqual(starter.phases, ["pending"]);
    sourceWriter.exec("COMMIT");
    const finished = await starter.finished;
    assert.equal(finished.code, 0, finished.stderr);
    assert.deepEqual(starter.phases, ["pending", "result"]);
  } finally {
    try {
      sourceWriter.exec("ROLLBACK");
    } catch {
      // The source transaction was committed after the pending event.
    }
    sourceWriter.close();
  }
});

test("server startup emits one pending and terminal status to stderr only", () => {
  const stderr = process.stderr as unknown as {
    write: (chunk: string) => boolean;
  };
  const originalWrite = stderr.write;
  const messagesFor = (start: () => void): string[] => {
    const messages: string[] = [];
    stderr.write = (chunk: string) => {
      messages.push(chunk);
      return true;
    };
    try {
      start();
      return messages;
    } finally {
      stderr.write = originalWrite;
    }
  };
  try {
    const freshPath = join(directory, "startup-fresh.sqlite");
    assert.deepEqual(
      messagesFor(() => {
        const fresh = createTodojoServer({ store: { dbPath: freshPath } });
        fresh.repository.close();
      }),
      ["todojo migration pending\n", "todojo migration result\n"],
    );

    const v0Path = join(directory, "startup-v0.sqlite");
    const v0 = legacyDatabase(v0Path);
    v0.close();
    assert.deepEqual(
      messagesFor(() => {
        const started = createTodojoServer({ store: { dbPath: v0Path } });
        started.repository.close();
      }),
      ["todojo migration pending\n", "todojo migration result\n"],
    );

    const v1Path = join(directory, "startup-v1.sqlite");
    const v1Fixture = new SQLiteTaskPlanRepository({ dbPath: v1Path });
    v1Fixture.close();
    assert.deepEqual(
      messagesFor(() => {
        const started = createTodojoServer({ store: { dbPath: v1Path } });
        started.repository.close();
      }),
      ["todojo migration pending\n", "todojo migration result\n"],
    );

    const futurePath = join(directory, "startup-future.sqlite");
    const future = new DatabaseSync(futurePath);
    future.exec("CREATE TABLE retained (id INTEGER); PRAGMA user_version = 2");
    future.close();
    assert.deepEqual(
      messagesFor(() => {
        assert.throws(() =>
          createTodojoServer({ store: { dbPath: futurePath } }),
        );
      }),
      ["todojo migration pending\n", "todojo migration error\n"],
    );
  } finally {
    stderr.write = originalWrite;
  }
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
