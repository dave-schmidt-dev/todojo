import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRegisteredApp } from "./tunnel-app.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
if (args.some((arg) => !["--preflight", "--tunnel-preflight"].includes(arg))) {
  throw new Error("Usage: verify-local.mjs [--preflight|--tunnel-preflight]");
}
if (args.length > 1) throw new Error("Choose one local preflight mode");
const preflightOnly = args.includes("--preflight");
const tunnelPreflight = args.includes("--tunnel-preflight");
const packageRoot = join(root, "dist/todojo");
const cacheBase = join(
  root,
  ".test-profile/codex-home/plugins/cache/todojo-local/todojo",
);

function fail(message) {
  throw new Error(`Local verification failed: ${message}`);
}

function installedRoot() {
  if (!existsSync(cacheBase)) fail("isolated ToDoJo plugin cache is missing");
  const versions = readdirSync(cacheBase, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  );
  if (versions.length !== 1)
    fail(`expected one isolated installed version, found ${versions.length}`);
  return join(cacheBase, versions[0].name);
}

async function run(label, command, commandArgs, env = process.env) {
  process.stderr.write(`${label} pending\n`);
  const child = spawn(command, commandArgs, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  const pulse = setInterval(
    () => process.stderr.write(`${label} running\n`),
    5_000,
  );
  const timeout = setTimeout(() => child.kill("SIGTERM"), 30_000);
  try {
    const code = await new Promise((done, reject) => {
      child.once("error", reject);
      child.once("exit", done);
    });
    if (code !== 0) fail(`${label} exited ${code}`);
    process.stderr.write(`${label} result\n`);
  } finally {
    clearInterval(pulse);
    clearTimeout(timeout);
  }
}

const installed = installedRoot();
const sourcePlugin = JSON.parse(
  readFileSync(join(root, "plugin.json"), "utf8"),
);
const installedPlugin = JSON.parse(
  readFileSync(join(installed, "plugin.json"), "utf8"),
);
if (
  installedPlugin.name !== sourcePlugin.name ||
  installedPlugin.version !== sourcePlugin.version
)
  fail("installed plugin identity differs from the source manifest");
const config = JSON.parse(readFileSync(join(installed, "mcp.json"), "utf8"));
const configuredDb = config.mcpServers?.todojo?.env?.TODOJO_DB_PATH;
const expectedDb = resolve(root, ".data/todojo.sqlite");
if (configuredDb !== expectedDb)
  fail("installed MCP database path differs from the persistent project path");
if (!existsSync(packageRoot)) fail("built package is missing");
const env = { ...process.env, TODOJO_INSTALLED_ROOT: installed };
await run("installed package parity", process.execPath, [
  "scripts/verify-package.mjs",
  "--installed-path",
  installed,
]);
await run(
  "installed read-only launcher",
  process.execPath,
  ["--import", "tsx", "--test", "tests/installed-launcher.test.ts"],
  env,
);
if (!preflightOnly) {
  await run(
    "installed cross-process database",
    process.execPath,
    ["--import", "tsx", "--test", "tests/installed-db.test.ts"],
    env,
  );
  await run(
    "local acceptance record",
    process.execPath,
    ["--import", "tsx", "--test", "tests/local-desktop.test.ts"],
    env,
  );
}
if (tunnelPreflight) {
  await run(
    "tunnel key-isolation and app-binding tests",
    process.execPath,
    [
      "--import",
      "tsx",
      "--test",
      "tests/tunnel-env.test.ts",
      "tests/tunnel-acceptance.test.ts",
    ],
    env,
  );
  const appId = validateRegisteredApp(root, packageRoot);
  process.stderr.write(`registered app binding valid: ${appId}\n`);
}
console.log(
  `ToDoJo local ${preflightOnly ? "preflight" : tunnelPreflight ? "tunnel preflight" : "record gate"}: passed; installed root ${installed}`,
);
