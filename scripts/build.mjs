import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { build } from "esbuild";

const output = resolve("dist/todojo-mcp.mjs");
mkdirSync(dirname(output), { recursive: true });
const widgetOutput = resolve("dist/todojo-widget.js");
const browserBuild = await build({
  entryPoints: ["web/src/component.tsx"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2024",
  write: false,
  minify: true,
  legalComments: "none",
});
const css = readFileSync(resolve("web/src/styles.css"), "utf8");
const browserScript = browserBuild.outputFiles[0]?.text;
if (!browserScript)
  throw new Error("ToDoJo widget build produced no JavaScript");
writeFileSync(
  widgetOutput,
  `(()=>{const style=document.createElement("style");style.textContent=${JSON.stringify(css)};document.head.append(style);})();\n${browserScript}`,
);
const widget = readFileSync(widgetOutput, "utf8");
await build({
  entryPoints: ["server/src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  outfile: output,
  banner: { js: "#!/usr/bin/env node" },
  define: { __TODOJO_BUNDLE__: JSON.stringify(widget) },
});

const packageRoot = resolve("dist/todojo");
const databasePath =
  process.env.TODOJO_DB_PATH ?? resolve(".data/todojo.sqlite");
if (!isAbsolute(databasePath)) {
  throw new Error(
    "TODOJO_DB_PATH must be absolute when building a plugin package",
  );
}
rmSync(packageRoot, { recursive: true, force: true });
mkdirSync(join(packageRoot, "bin"), { recursive: true });
cpSync(resolve("plugin.json"), join(packageRoot, "plugin.json"));
const packageLauncher = join(packageRoot, "bin/todojo-mcp");
writeFileSync(
  packageLauncher,
  '#!/bin/sh\nexec node "$(dirname "$0")/../todojo-mcp.mjs" "$@"\n',
);
chmodSync(packageLauncher, 0o755);
cpSync(output, join(packageRoot, "todojo-mcp.mjs"));
if (existsSync(resolve("skills")))
  cpSync(resolve("skills"), join(packageRoot, "skills"), { recursive: true });
if (existsSync(resolve("assets")))
  cpSync(resolve("assets"), join(packageRoot, "assets"), { recursive: true });

const packageMcp = JSON.parse(readFileSync(resolve("mcp.json"), "utf8"));
packageMcp.mcpServers.todojo.env = { TODOJO_DB_PATH: databasePath };
writeFileSync(
  join(packageRoot, "mcp.json"),
  `${JSON.stringify(packageMcp, null, 2)}\n`,
);
