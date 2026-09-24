import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
