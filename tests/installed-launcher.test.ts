import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const installedRoot = process.env.TODOJO_INSTALLED_ROOT;

interface InstalledMcpConfig {
  mcpServers: {
    todojo: {
      command: string;
      cwd: string;
      env: { TODOJO_DB_PATH: string };
    };
  };
}

test("installed plugin launcher serves a tool using its injected database path", {
  skip: !installedRoot,
  timeout: 15_000,
}, async () => {
  assert.ok(installedRoot);
  const manifest = JSON.parse(
    readFileSync(join(installedRoot, "mcp.json"), "utf8"),
  ) as InstalledMcpConfig;
  const config = manifest.mcpServers.todojo;
  assert.equal(config.command, "./bin/todojo-mcp");
  assert.equal(config.cwd, "./");
  assert.ok(isAbsolute(config.env.TODOJO_DB_PATH));
  assert.notEqual(
    statSync(join(installedRoot, "bin/todojo-mcp")).mode & 0o111,
    0,
  );

  const transport = new StdioClientTransport({
    command: join(installedRoot, "bin/todojo-mcp"),
    cwd: installedRoot,
    env: {
      PATH: process.env.PATH ?? "",
      TODOJO_DB_PATH: config.env.TODOJO_DB_PATH,
    },
    stderr: "pipe",
  });
  const client = new Client({
    name: "todojo-installed-test",
    version: "0.1.0",
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "list_task_plans"));
    const result = await client.callTool({
      name: "list_task_plans",
      arguments: {},
    });
    assert.equal(result.isError, undefined);
    assert.ok(
      Array.isArray((result.structuredContent as { plans: unknown[] }).plans),
    );
    assert.ok(existsSync(config.env.TODOJO_DB_PATH));
  } finally {
    await client.close();
  }
});
