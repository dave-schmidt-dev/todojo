import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = resolve(import.meta.dirname, "..");
const launcher = join(root, "bin", "todojo-mcp");
const temporary = mkdtempSync(join(tmpdir(), "todojo-installed-launcher-"));
const installed = join(temporary, "installed");
const outside = join(temporary, "outside");
const dbPath = join(temporary, "data", "todojo.sqlite");
const logPath = join(temporary, "logs", "todojo.log");
let client;
let passed = false;

function status(message) {
  process.stderr.write(`ToDoJo launcher check: ${message}\n`);
}

async function bounded(label, operation, timeoutMs = 15_000) {
  status(label);
  const heartbeat = setInterval(() => status(`${label} still running`), 2_000);
  let timeout;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearInterval(heartbeat);
    clearTimeout(timeout);
  }
}

try {
  assert.ok(statSync(launcher).mode & 0o111, "launcher must be executable");
  status("building server bundle");
  await import("./build.mjs");
  mkdirSync(join(installed, "bin"), { recursive: true });
  mkdirSync(join(installed, "dist"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  copyFileSync(launcher, join(installed, "bin", "todojo-mcp"));
  status(
    `copied launcher mode ${(statSync(join(installed, "bin", "todojo-mcp")).mode & 0o777).toString(8)}`,
  );
  copyFileSync(
    join(root, "dist", "todojo-mcp.mjs"),
    join(installed, "dist", "todojo-mcp.mjs"),
  );
  assert.equal(existsSync(join(installed, "node_modules")), false);
  status(`installed Node ${process.execPath} ${process.version}`);
  const nodeVersion = execFileSync("node", ["--version"], {
    env: {
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
    timeout: 5_000,
  }).trim();
  assert.equal(nodeVersion, process.version);
  status(
    `copied package ${installed}; launcher bytes ${statSync(join(installed, "bin", "todojo-mcp")).size}; bundle bytes ${statSync(join(installed, "dist", "todojo-mcp.mjs")).size}`,
  );
  const transport = new StdioClientTransport({
    command: join(installed, "bin", "todojo-mcp"),
    cwd: outside,
    env: {
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
      TODOJO_DB_PATH: dbPath,
      TODOJO_LOG_PATH: logPath,
    },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    process.stderr.write(`ToDoJo installed server: ${String(chunk)}`);
  });
  client = new Client({ name: "todojo-installed-smoke", version: "0.1.0" });
  const timeline = [];
  client.setNotificationHandler("notifications/message", (notification) => {
    timeline.push(String(notification.params.data));
  });
  try {
    await bounded("connecting to copied launcher outside source checkout", () =>
      client.connect(transport),
    );
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    status(`connection failed; child pid ${transport.pid}; kept ${installed}`);
    throw error;
  }
  const tools = await bounded("listing installed tools", () =>
    client.listTools(),
  );
  assert.ok(tools.tools.some((tool) => tool.name === "render_todojo"));
  status("creating and reading a persisted plan over stdio");
  const created = await client.callTool({
    name: "create_task_plan",
    arguments: {
      tasks: [{ title: "Installed launcher smoke" }],
      start_first: true,
    },
  });
  assert.equal(created.isError, undefined);
  const planId = created.structuredContent?.plan_id;
  assert.equal(typeof planId, "string");
  const fetched = await bounded("reading the persisted plan over stdio", () =>
    client.callTool({
      name: "get_task_plan",
      arguments: { plan_id: planId },
    }),
  );
  assert.equal(fetched.structuredContent?.plan_id, planId);
  assert.ok(
    existsSync(dbPath),
    "installed server must use explicit database path",
  );
  assert.equal(existsSync(join(outside, ".logs")), false);
  status("passed installed stdio and persistent database round trip");
  passed = true;
} finally {
  await client?.close();
  if (passed) rmSync(temporary, { recursive: true, force: true });
}
