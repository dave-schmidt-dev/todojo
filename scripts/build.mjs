import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const output = resolve("dist/todojo-mcp.mjs");
mkdirSync(dirname(output), { recursive: true });
await build({
  entryPoints: ["server/src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  outfile: output,
  banner: { js: "#!/usr/bin/env node" },
});
