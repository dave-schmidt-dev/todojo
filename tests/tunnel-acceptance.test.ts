import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateRegisteredApp } from "../scripts/tunnel-app.mjs";

const id = "asdk_app_test123";
function fixture(sourceId = id, packageId = id, reference = "./.app.json") {
  const root = mkdtempSync(join(tmpdir(), "todojo-app-binding-"));
  const source = join(root, "source");
  const packaged = join(root, "packaged");
  for (const directory of [source, packaged]) mkdirSync(directory);
  writeFileSync(
    join(source, ".app.json"),
    JSON.stringify({ apps: { todojo: { id: sourceId } } }),
  );
  writeFileSync(
    join(packaged, ".app.json"),
    JSON.stringify({ apps: { todojo: { id: packageId } } }),
  );
  for (const directory of [source, packaged])
    writeFileSync(
      join(directory, "plugin.json"),
      JSON.stringify({ extensions: { "com.openai": { apps: reference } } }),
    );
  return { root, source, packaged };
}

test("registered app preflight binds one ID in source and built package", () => {
  const paths = fixture();
  try {
    assert.equal(validateRegisteredApp(paths.source, paths.packaged), id);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("registered app preflight rejects invented, mismatched, or unreferenced IDs", () => {
  for (const [sourceId, packageId, reference] of [
    ["made-up", id, "./.app.json"],
    [id, "asdk_app_other", "./.app.json"],
    [id, id, ""],
  ]) {
    const paths = fixture(sourceId, packageId, reference);
    try {
      assert.throws(() => validateRegisteredApp(paths.source, paths.packaged));
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  }
});
