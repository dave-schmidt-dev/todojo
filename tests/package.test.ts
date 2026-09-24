import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(".");

test("manifest-only package verification accepts portable source files", () => {
  execFileSync(
    process.execPath,
    ["scripts/verify-package.mjs", "--manifest-only"],
    {
      cwd: root,
      stdio: "pipe",
    },
  );
});

test("build stages a portable package with only a generated absolute database path", () => {
  const dbPath = resolve(".data/package-test.sqlite");
  execFileSync(process.execPath, ["scripts/build.mjs"], {
    cwd: root,
    env: { ...process.env, TODOJO_DB_PATH: dbPath },
    stdio: "pipe",
  });
  const packaged = resolve("dist/todojo");
  for (const file of [
    "plugin.json",
    "mcp.json",
    "bin/todojo-mcp",
    "todojo-mcp.mjs",
    "skills/todojo/SKILL.md",
  ]) {
    assert.equal(
      existsSync(resolve(packaged, file)),
      true,
      `${file} is missing`,
    );
  }
  assert.notEqual(
    statSync(resolve(packaged, "bin/todojo-mcp")).mode & 0o111,
    0,
  );
  assert.match(
    readFileSync(resolve(packaged, "bin/todojo-mcp"), "utf8"),
    /\.\.\/todojo-mcp\.mjs/,
  );
  const sourceMcp = JSON.parse(readFileSync(resolve("mcp.json"), "utf8"));
  const packagedMcp = JSON.parse(
    readFileSync(resolve(packaged, "mcp.json"), "utf8"),
  );
  assert.equal(sourceMcp.mcpServers.todojo.env, undefined);
  assert.deepEqual(packagedMcp.mcpServers.todojo.env, {
    TODOJO_DB_PATH: dbPath,
  });
  assert.equal(
    isAbsolute(packagedMcp.mcpServers.todojo.env.TODOJO_DB_PATH),
    true,
  );
});
