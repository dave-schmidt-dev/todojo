import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { validateRegisteredApp } from "./tunnel-app.mjs";

const root = resolve(".");
const args = process.argv.slice(2);
const manifestOnly = args.includes("--manifest-only");
const installedIndex = args.indexOf("--installed-path");
const installedPath =
  installedIndex >= 0 ? args[installedIndex + 1] : undefined;

if (installedIndex >= 0 && (!installedPath || installedPath.startsWith("--"))) {
  throw new Error("--installed-path requires an installed plugin root");
}
if (
  args.some(
    (arg) =>
      !["--manifest-only", "--installed-path", installedPath].includes(arg),
  )
) {
  throw new Error(
    "Usage: verify-package.mjs [--manifest-only] [--installed-path PATH]",
  );
}

const pluginSchema =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const mcpSchema = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const packageRoot = join(root, "dist/todojo");

function fail(message) {
  throw new Error(`Package verification failed: ${message}`);
}

function readJson(path) {
  if (!existsSync(path)) fail(`${relative(root, path)} is missing`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${relative(root, path)} is not valid JSON: ${String(error)}`);
  }
}

function equalKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\0") !== wanted.join("\0"))
    fail(`${label} must contain exactly: ${wanted.join(", ")}`);
}

function validatePlugin(plugin, label) {
  const allowed = [
    "$schema",
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "extensions",
  ];
  for (const key of Object.keys(plugin))
    if (!allowed.includes(key)) fail(`${label} has unsupported field ${key}`);
  if (plugin.$schema !== pluginSchema)
    fail(`${label} must use the Agent Plugins 1.0.0 schema`);
  if (plugin.name !== "todojo") fail(`${label} name must be todojo`);
  if (
    plugin.version !== "0.1.0" ||
    typeof plugin.description !== "string" ||
    !plugin.description
  )
    fail(`${label} must provide version and description`);
  const openai = plugin.extensions?.["com.openai"];
  if (!openai || typeof openai !== "object" || Array.isArray(openai))
    fail(`${label} must contain extensions.com.openai`);
  const interfaceConfig = openai.interface;
  if (!interfaceConfig || typeof interfaceConfig !== "object")
    fail(`${label} must contain extensions.com.openai.interface`);
  if (
    interfaceConfig.displayName !== "ToDoJo" ||
    interfaceConfig.category !== "Productivity"
  )
    fail(`${label} interface metadata is invalid`);
  if (JSON.stringify(plugin).includes("plugin_asdk_app"))
    fail(`${label} must not invent a registered ChatGPT app ID`);
}

function verifyRegisteredApp(sourceRoot, packagePath, label) {
  try {
    return validateRegisteredApp(sourceRoot, packagePath);
  } catch (error) {
    fail(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateMcp(mcp, label, generated = false) {
  equalKeys(mcp, ["$schema", "mcpServers"], label);
  if (mcp.$schema !== mcpSchema)
    fail(`${label} must use the Agent Plugins MCP 1.0.0 schema`);
  const server = mcp.mcpServers?.todojo;
  equalKeys(mcp.mcpServers, ["todojo"], `${label}.mcpServers`);
  if (
    server?.type !== "stdio" ||
    server.command !== "./bin/todojo-mcp" ||
    server.cwd !== "./"
  )
    fail(`${label} must use the portable ToDoJo stdio command and cwd`);
  const permitted = generated
    ? ["type", "command", "cwd", "env"]
    : ["type", "command", "cwd"];
  equalKeys(server, permitted, `${label}.mcpServers.todojo`);
  if (generated) {
    equalKeys(server.env, ["TODOJO_DB_PATH"], `${label}.mcpServers.todojo.env`);
    if (!isAbsolute(server.env.TODOJO_DB_PATH))
      fail(`${label} TODOJO_DB_PATH must be absolute`);
  }
}

function filesRelativeTo(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(directory, path));
    }
  };
  walk(directory);
  return files.sort();
}

function installedFilesRelativeTo(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const file = relative(directory, path);
      if (file === ".codex-plugin") continue;
      if (entry.isSymbolicLink()) {
        fail(
          `installed package contains symlink outside .codex-plugin: ${file}`,
        );
      }
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(file);
      else fail(`installed package contains unsupported entry: ${file}`);
    }
  };
  walk(directory);
  return files.sort();
}

function verifySource() {
  const plugin = readJson(join(root, "plugin.json"));
  const mcp = readJson(join(root, "mcp.json"));
  validatePlugin(plugin, "plugin.json");
  validateMcp(mcp, "mcp.json");
  if (existsSync(join(root, ".app.json"))) {
    verifyRegisteredApp(root, root, "source app binding is invalid");
  } else if (plugin.extensions?.["com.openai"]?.apps !== undefined) {
    fail("plugin.json references a registered app but .app.json is missing");
  }
  const sourceMcpText = readFileSync(join(root, "mcp.json"), "utf8");
  if (
    /TODOJO_DB_PATH|plugin_asdk_app|(?:^|["'])\/(?:Users|home|private)\//m.test(
      sourceMcpText,
    )
  )
    fail("mcp.json contains generated state, an app ID, or a host path");

  const marketplace = readJson(join(root, ".agents/plugins/marketplace.json"));
  const entry = marketplace.plugins?.find(
    (candidate) => candidate.name === "todojo",
  );
  if (!entry) fail("marketplace must include todojo");
  if (
    entry.source?.source !== "local" ||
    entry.source?.path !== "./dist/todojo"
  )
    fail("marketplace todojo source.path must equal ./dist/todojo");
  if (
    entry.policy?.installation !== "AVAILABLE" ||
    entry.policy?.authentication !== "ON_INSTALL" ||
    entry.category !== "Productivity"
  )
    fail("marketplace todojo policy/category fields are invalid");
}

function verifyArtifact() {
  if (!existsSync(packageRoot))
    fail("dist/todojo is missing; run npm run build first");
  const packagePlugin = readJson(join(packageRoot, "plugin.json"));
  const packageMcp = readJson(join(packageRoot, "mcp.json"));
  validatePlugin(packagePlugin, "dist/todojo/plugin.json");
  validateMcp(packageMcp, "dist/todojo/mcp.json", true);
  if (existsSync(join(root, ".app.json"))) {
    verifyRegisteredApp(root, packageRoot, "packaged app binding is invalid");
  } else if (existsSync(join(packageRoot, ".app.json"))) {
    fail("dist/todojo/.app.json exists without a registered source app");
  }
  for (const path of [
    "bin/todojo-mcp",
    "bin/todojo-tunnel-child",
    "todojo-mcp.mjs",
    "skills/todojo/SKILL.md",
  ]) {
    if (!existsSync(join(packageRoot, path)))
      fail(`dist/todojo/${path} is missing`);
  }
  for (const launcher of ["bin/todojo-mcp", "bin/todojo-tunnel-child"]) {
    if ((statSync(join(packageRoot, launcher)).mode & 0o111) === 0)
      fail(`packaged ${launcher} is not executable`);
  }
  if (
    !readFileSync(join(packageRoot, "bin/todojo-mcp"), "utf8").includes(
      "../todojo-mcp.mjs",
    )
  )
    fail("packaged launcher does not resolve the self-contained MCP bundle");
  const banned = new Set([
    "node_modules",
    ".git",
    ".data",
    ".logs",
    ".env",
    "package.json",
    "package-lock.json",
  ]);
  for (const file of filesRelativeTo(packageRoot)) {
    if (file.split("/").some((segment) => banned.has(segment)))
      fail(`artifact contains development state: ${file}`);
    if (
      file !== "mcp.json" &&
      /(?:^|["'])\/(?:Users|home|private)\//m.test(
        readFileSync(join(packageRoot, file), "utf8"),
      )
    )
      fail(`artifact leaks a host path in ${file}`);
  }
  const artwork = [
    "assets/source/todojo-light-dark.png",
    "assets/icons/todojo-light.png",
    "assets/icons/todojo-dark.png",
  ];
  if (!artwork.every((asset) => existsSync(join(packageRoot, asset)))) {
    fail(
      "artifact is missing the owner source art or Task 4.2 light/dark icon variants",
    );
  }
}

function verifyInstalled(path) {
  const installed = resolve(path);
  if (!existsSync(installed) || !lstatSync(installed).isDirectory())
    fail(`installed path is not a directory: ${path}`);
  const expectedFiles = filesRelativeTo(packageRoot);
  const installedFiles = installedFilesRelativeTo(installed);
  const expectedSet = new Set(expectedFiles);
  const installedSet = new Set(installedFiles);
  const unexpectedFiles = installedFiles.filter(
    (file) => !expectedSet.has(file),
  );
  if (unexpectedFiles.length) {
    const list = unexpectedFiles.join(", ");
    fail(`installed package contains unexpected files: ${list}`);
  }
  for (const file of expectedFiles) {
    const installedFile = join(installed, file);
    if (!installedSet.has(file)) fail(`installed package is missing ${file}`);
    if (
      !readFileSync(join(packageRoot, file)).equals(readFileSync(installedFile))
    ) {
      fail(`installed bytes differ for ${file}`);
    }
  }
  const overlay = join(installed, ".codex-plugin");
  console.log(
    existsSync(overlay)
      ? "installed overlay: .codex-plugin present"
      : "installed overlay: none",
  );
}

verifySource();
console.log("source manifests: ok");
if (!manifestOnly) {
  verifyArtifact();
  console.log("artifact: ok");
  if (installedPath) {
    verifyInstalled(installedPath);
    console.log("installed bytes: ok");
  } else {
    console.log("installed bytes: pending Task 4.2 (pass --installed-path)");
  }
}
