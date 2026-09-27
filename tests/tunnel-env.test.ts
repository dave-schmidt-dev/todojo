import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function fixture(dbPath: string) {
  const root = mkdtempSync(join(tmpdir(), "todojo-tunnel-env-"));
  cpSync("bin/todojo-tunnel-child", join(root, "bin/todojo-tunnel-child"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "mcp.json"),
    JSON.stringify({
      mcpServers: { todojo: { env: { TODOJO_DB_PATH: dbPath } } },
    }),
  );
  writeFileSync(
    join(root, "todojo-mcp.mjs"),
    "process.stdout.write(JSON.stringify({env:process.env,argv:process.argv.slice(2)}))",
  );
  return root;
}

test("tunnel child passes only the packaged DB path to MCP", () => {
  const dbPath = join(tmpdir(), "todojo-tunnel-fixture.sqlite");
  const root = fixture(dbPath);
  try {
    const result = spawnSync(
      process.execPath,
      [join(root, "bin/todojo-tunnel-child")],
      {
        env: {
          CONTROL_PLANE_API_KEY: "synthetic-test-marker",
          OPENAI_API_KEY: "synthetic-test-marker",
          BWS_ACCESS_TOKEN: "synthetic-test-marker",
          NODE_OPTIONS: "",
          TODOJO_SENTINEL: "synthetic-test-marker",
        },
        encoding: "utf8",
        timeout: 5_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout) as {
      env: Record<string, string>;
      argv: string[];
    };
    assert.equal(observed.env.TODOJO_DB_PATH, dbPath);
    // macOS injects this process metadata even with a minimal spawn environment.
    assert.deepEqual(
      Object.keys(observed.env).filter(
        (key) => key !== "__CF_USER_TEXT_ENCODING",
      ),
      ["TODOJO_DB_PATH"],
    );
    assert.deepEqual(observed.argv, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tunnel child rejects a missing or relative packaged DB path", () => {
  const root = fixture("relative.sqlite");
  try {
    const result = spawnSync(
      process.execPath,
      [join(root, "bin/todojo-tunnel-child")],
      {
        encoding: "utf8",
        timeout: 5_000,
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /absolute database path/);
    const config = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8"));
    delete config.mcpServers.todojo.env.TODOJO_DB_PATH;
    writeFileSync(join(root, "mcp.json"), JSON.stringify(config));
    const missing = spawnSync(
      process.execPath,
      [join(root, "bin/todojo-tunnel-child")],
      {
        encoding: "utf8",
        timeout: 5_000,
      },
    );
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /absolute database path/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
