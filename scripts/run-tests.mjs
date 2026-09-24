import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [suite, ...options] = process.argv.slice(2);
const suites = {
  core: [
    "state-transitions",
    "timers",
    "ids",
    "persistence",
    "concurrency",
    "snapshot-race",
    "progress-visibility",
  ],
  server: [
    "tools",
    "transports",
    "progress-visibility",
    "runtime-smoke",
    "instructions",
    "bridge-contract",
  ],
};

if (!Object.hasOwn(suites, suite)) {
  console.error(`Unknown test suite: ${suite}`);
  process.exit(2);
}

const files = suites[suite]
  .map((name) => join(root, "tests", `${name}.test.ts`))
  .filter(existsSync)
  .map((path) => relative(root, path));

if (files.length === 0) {
  console.error(
    `No ${suite} tests installed yet. The suite cannot pass without tests.`,
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...options, ...files],
  {
    cwd: root,
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
