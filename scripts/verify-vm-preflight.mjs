import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const versionsOnly = process.argv.includes("--versions-only");

function compareVersion(actual, required) {
  const left = actual.split(".").map(Number);
  const right = required.split(".").map(Number);
  for (let index = 0; index < right.length; index += 1) {
    if ((left[index] ?? 0) !== right[index])
      return (left[index] ?? 0) > right[index];
  }
  return true;
}

function resolveCommand(command) {
  for (const directory of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const candidate = join(directory, command);
    try {
      return realpathSync(candidate);
    } catch {
      // Continue through PATH entries; a missing command is reported below.
    }
  }
  throw new Error(`${command} was not found on PATH`);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr || result.error || result.status}`,
    );
  return result.stdout.trim();
}

const nodeVersion = process.versions.node;
const npmVersion = run("npm", ["--version"]);
console.log(`Node ${realpathSync(process.execPath)}: ${nodeVersion}`);
console.log(`npm ${resolveCommand("npm")}: ${npmVersion}`);
if (!compareVersion(nodeVersion, "26.7.0"))
  throw new Error(`Node >=26.7.0 is required, found ${nodeVersion}`);
if (!compareVersion(npmVersion, "11.0.0"))
  throw new Error(`npm >=11.0.0 is required, found ${npmVersion}`);

if (versionsOnly) process.exit(0);

console.log("Launching the pinned headless Chromium browser probe.");
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent("<main>ToDoJo browser preflight</main>");
  const text = await page.locator("main").textContent();
  if (text !== "ToDoJo browser preflight")
    throw new Error(`Unexpected Chromium result: ${text}`);
  console.log("Pinned headless Chromium launched and rendered the probe.");
} finally {
  await browser.close();
}
