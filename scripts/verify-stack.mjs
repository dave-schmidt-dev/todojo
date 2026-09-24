import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const typecheckOnly = process.argv.includes("--typecheck-only");

function run(label, command, args) {
  console.error(`ToDoJo stack check: ${label}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function collectTypeScript(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...collectTypeScript(path));
    else if (/\.tsx?$/.test(entry.name)) found.push(relative(root, path));
  }
  return found.sort();
}

const tscOptions = [
  "--noEmit",
  "--strict",
  "--skipLibCheck",
  "--target",
  "ES2024",
];
run("compile the pinned package probe", "tsc", [
  ...tscOptions,
  "--module",
  "NodeNext",
  "--moduleResolution",
  "NodeNext",
  "--jsx",
  "react-jsx",
  "--lib",
  "ES2024,DOM",
  "--types",
  "node,react,react-dom",
  "tests/stack-probe.ts",
]);

for (const [workspace, module, resolution, jsx, types, lib] of [
  ["server", "NodeNext", "NodeNext", undefined, "node", "ES2024"],
  ["web", "ESNext", "Bundler", "react-jsx", "react,react-dom", "ES2024,DOM"],
]) {
  const config = join(root, workspace, "tsconfig.json");
  if (existsSync(config)) {
    run(`typecheck ${workspace} workspace`, "tsc", [
      "--noEmit",
      "--project",
      config,
    ]);
    continue;
  }
  const source = collectTypeScript(join(root, workspace, "src"));
  if (source.length === 0) continue;
  const args = [
    ...tscOptions,
    "--module",
    module,
    "--moduleResolution",
    resolution,
    "--lib",
    lib,
    "--types",
    types,
  ];
  if (jsx) args.push("--jsx", jsx);
  run(`typecheck ${workspace} source`, "tsc", [...args, ...source]);
}

if (!typecheckOnly)
  run(
    "execute MCP, React, SQLite, esbuild, and Playwright stack tests",
    process.execPath,
    ["--import", "tsx", "--test", "tests/stack-probe.ts"],
  );
