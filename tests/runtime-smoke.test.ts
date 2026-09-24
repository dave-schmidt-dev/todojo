import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { resolveLogPath, TodojoLogger } from "../server/src/logging.ts";
import { resolveDatabasePath } from "../server/src/sqlite-store.ts";

const directory = mkdtempSync(join(tmpdir(), "todojo-runtime-"));
after(() => rmSync(directory, { recursive: true, force: true }));

test("installed runtime rejects relative database paths and host launcher has executable mode", () => {
  assert.throws(
    () => resolveDatabasePath({ dbPath: "relative.sqlite" }),
    /absolute/,
  );
  assert.equal(
    resolveDatabasePath({ dbPath: join(directory, "data.sqlite") }),
    join(directory, "data.sqlite"),
  );
  assert.notEqual(statSync(resolve("bin/todojo-mcp")).mode & 0o111, 0);
});

test("bundled stdio entry starts and fails fast without its required installed database path", () => {
  const build = spawnSync(process.execPath, ["scripts/build.mjs"], {
    encoding: "utf8",
  });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(process.execPath, ["dist/todojo-mcp.mjs"], {
    encoding: "utf8",
    env: { ...process.env, TODOJO_DB_PATH: "relative.sqlite" },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /startup failed.*absolute/);
  assert.equal(run.stdout, "");
});

test("logs stay beside the explicit database and persist warnings by default", () => {
  const dbPath = join(directory, ".data", "logging.sqlite");
  const logPath = resolveLogPath(dbPath);
  assert.equal(logPath, join(directory, ".logs", "todojo.log"));
  const logger = new TodojoLogger(logPath, false);
  logger.info("routine status");
  assert.equal(existsSync(logPath), false);
  logger.warn("actionable warning");
  assert.match(readFileSync(logPath, "utf8"), /WARN actionable warning/);
  assert.doesNotMatch(readFileSync(logPath, "utf8"), /routine status/);
});
