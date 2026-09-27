import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateRegisteredApp(sourceRoot, packageRoot) {
  const sourcePath = join(sourceRoot, ".app.json");
  const packagePath = join(packageRoot, ".app.json");
  if (!existsSync(sourcePath))
    throw new Error("owner-registered .app.json is missing");
  if (!existsSync(packagePath))
    throw new Error("built package is missing .app.json");
  const source = readJson(sourcePath);
  const packaged = readJson(packagePath);
  const sourceId = source.apps?.todojo?.id;
  const packageId = packaged.apps?.todojo?.id;
  if (
    !/^(?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9][A-Za-z0-9_-]*$/.test(
      sourceId ?? "",
    )
  )
    throw new Error("registered ToDoJo app ID is missing or invalid");
  if (Object.keys(source.apps).length !== 1)
    throw new Error("registered manifest must contain only ToDoJo");
  if (sourceId !== packageId)
    throw new Error(
      "built package app ID differs from the registered source ID",
    );
  for (const [label, root] of [
    ["source", sourceRoot],
    ["built package", packageRoot],
  ]) {
    const plugin = readJson(join(root, "plugin.json"));
    if (plugin.extensions?.["com.openai"]?.apps !== "./.app.json")
      throw new Error(`${label} plugin must reference ./.app.json`);
  }
  return sourceId;
}
