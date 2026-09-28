import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(".");

function packageFileCount(directory: string): number {
  let count = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) count += packageFileCount(path);
    else if (entry.isFile()) count++;
  }
  return count;
}

test("manifest-only package verification accepts portable source files", () => {
  execFileSync(
    process.execPath,
    ["scripts/verify-package.mjs", "--manifest-only"],
    {
      cwd: root,
      stdio: "pipe",
    },
  );
});

test("build stages a portable package without changing the canonical package", () => {
  const dbPath = resolve(".data/package-test.sqlite");
  const packaged = mkdtempSync(join(tmpdir(), "todojo-package-test-"));
  const canonicalMcp = resolve("dist/todojo/mcp.json");
  const canonicalMcpBefore = existsSync(canonicalMcp)
    ? readFileSync(canonicalMcp)
    : undefined;
  try {
    execFileSync(process.execPath, ["scripts/build.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        TODOJO_DB_PATH: dbPath,
        TODOJO_PACKAGE_ROOT: packaged,
      },
      stdio: "pipe",
    });
    for (const file of [
      "plugin.json",
      "mcp.json",
      "bin/todojo-mcp",
      "bin/todojo-tunnel-child",
      "todojo-mcp.mjs",
      "skills/todojo/SKILL.md",
    ]) {
      assert.equal(
        existsSync(resolve(packaged, file)),
        true,
        `${file} is missing`,
      );
    }
    assert.notEqual(
      statSync(resolve(packaged, "bin/todojo-mcp")).mode & 0o111,
      0,
    );
    assert.equal(
      packageFileCount(packaged),
      9,
      "unregistered local package must contain exactly nine files",
    );
    assert.match(
      readFileSync(resolve(packaged, "bin/todojo-mcp"), "utf8"),
      /\.\.\/todojo-mcp\.mjs/,
    );
    const sourceMcp = JSON.parse(readFileSync(resolve("mcp.json"), "utf8"));
    const packagedMcp = JSON.parse(
      readFileSync(resolve(packaged, "mcp.json"), "utf8"),
    );
    assert.equal(sourceMcp.mcpServers.todojo.env, undefined);
    assert.deepEqual(packagedMcp.mcpServers.todojo.env, {
      TODOJO_DB_PATH: dbPath,
    });
    assert.equal(
      isAbsolute(packagedMcp.mcpServers.todojo.env.TODOJO_DB_PATH),
      true,
    );
    assert.equal(
      existsSync(canonicalMcp),
      canonicalMcpBefore !== undefined,
      "the canonical package mcp.json presence changed",
    );
    if (canonicalMcpBefore !== undefined) {
      assert.deepEqual(
        readFileSync(canonicalMcp),
        canonicalMcpBefore,
        "the canonical package mcp.json bytes changed",
      );
    }
  } finally {
    rmSync(packaged, { recursive: true, force: true });
  }
});

function registeredBuildFixture(
  appId: string,
  appReference: string | null = "./.app.json",
) {
  const project = mkdtempSync(join(tmpdir(), "todojo-registered-build-"));
  for (const path of [
    "plugin.json",
    "package.json",
    "package-lock.json",
    "mcp.json",
    "scripts/build.mjs",
    "scripts/verify-package.mjs",
    "scripts/tunnel-app.mjs",
    "bin/todojo-tunnel-child",
    "server/src",
    "server/package.json",
    "web/src",
    "web/package.json",
    "skills",
    "assets",
    ".agents/plugins",
  ]) {
    const target = join(project, path);
    mkdirSync(resolve(target, ".."), { recursive: true });
    cpSync(join(root, path), target, { recursive: true });
  }
  symlinkSync(resolve("node_modules"), join(project, "node_modules"), "dir");

  const pluginPath = join(project, "plugin.json");
  const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
  if (appReference === null) {
    delete plugin.extensions["com.openai"].apps;
  } else {
    plugin.extensions["com.openai"].apps = appReference;
  }
  writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`);
  writeFileSync(
    join(project, ".app.json"),
    `${JSON.stringify({ apps: { todojo: { id: appId } } }, null, 2)}\n`,
  );
  return project;
}

function runFixture(project: string, script: string) {
  return spawnSync(process.execPath, [script], {
    cwd: project,
    env: {
      ...process.env,
      TODOJO_DB_PATH: join(project, ".data/todojo.sqlite"),
    },
    encoding: "utf8",
  });
}

test("registered app build and package verification bind one synthetic app", () => {
  const project = registeredBuildFixture("asdk_app_fixture123");
  try {
    const build = runFixture(project, "scripts/build.mjs");
    assert.equal(build.status, 0, build.stderr ?? build.error?.message ?? "");

    const verify = runFixture(project, "scripts/verify-package.mjs");
    assert.equal(
      verify.status,
      0,
      verify.stderr ?? verify.error?.message ?? "",
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(project, "dist/todojo/.app.json"), "utf8")),
      { apps: { todojo: { id: "asdk_app_fixture123" } } },
    );

    const packagedApp = join(project, "dist/todojo/.app.json");
    writeFileSync(
      packagedApp,
      JSON.stringify({ apps: { todojo: { id: "placeholder" } } }),
    );
    const invalidPackage = runFixture(project, "scripts/verify-package.mjs");
    assert.notEqual(invalidPackage.status, 0, "placeholder app ID passed");
    assert.match(
      invalidPackage.stderr ?? "",
      /app ID differs from the registered source ID/,
    );

    writeFileSync(
      packagedApp,
      JSON.stringify({ apps: { todojo: { id: "asdk_app_fixture123" } } }),
    );
    const pluginPath = join(project, "dist/todojo/plugin.json");
    const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
    delete plugin.extensions["com.openai"].apps;
    writeFileSync(pluginPath, JSON.stringify(plugin));
    const unreferencedPackage = runFixture(
      project,
      "scripts/verify-package.mjs",
    );
    assert.notEqual(
      unreferencedPackage.status,
      0,
      "unreferenced packaged app passed",
    );
    assert.match(
      unreferencedPackage.stderr ?? "",
      /must reference \.\/\.app\.json/,
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("registered app build rejects placeholder and unreferenced source bindings", () => {
  const invalidCases: Array<[string, string | null, RegExp]> = [
    [
      "placeholder",
      "./.app.json",
      /registered ToDoJo app ID is missing or invalid/,
    ],
    ["asdk_app_fixture123", null, /must reference \.\/\.app\.json/],
  ];
  for (const [appId, appReference, expected] of invalidCases) {
    const project = registeredBuildFixture(appId, appReference);
    try {
      const build = runFixture(project, "scripts/build.mjs");
      assert.notEqual(build.status, 0, "invalid source registration built");
      assert.match(build.stderr ?? "", expected);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }
});

test("manifest-only package verification rejects a derived version mismatch", () => {
  const project = registeredBuildFixture("asdk_app_fixture123");
  try {
    const rootManifest = JSON.parse(
      readFileSync(join(project, "package.json"), "utf8"),
    );
    const rootVersion = rootManifest.version as string;
    const serverManifestPath = join(project, "server/package.json");
    const serverManifest = JSON.parse(readFileSync(serverManifestPath, "utf8"));
    serverManifest.version = `${rootVersion}-mismatch`;
    writeFileSync(serverManifestPath, `${JSON.stringify(serverManifest)}\n`);

    const verify = spawnSync(
      process.execPath,
      ["scripts/verify-package.mjs", "--manifest-only"],
      { cwd: project, encoding: "utf8" },
    );
    assert.notEqual(verify.status, 0, "derived version mismatch passed");
    assert.match(
      verify.stderr ?? "",
      new RegExp(
        `server/package\\.json version must equal package\\.json \\(${rootVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`,
      ),
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("installed package verification requires an exact regular-file inventory", () => {
  const packageRoot = resolve("dist/todojo");
  const exactParent = mkdtempSync(join(tmpdir(), "todojo-package-exact-"));
  const extraParent = mkdtempSync(join(tmpdir(), "todojo-package-extra-"));
  const exactInstalled = join(exactParent, "todojo");
  const extraInstalled = join(extraParent, "todojo");
  try {
    cpSync(packageRoot, exactInstalled, { recursive: true });
    cpSync(packageRoot, extraInstalled, { recursive: true });
    writeFileSync(join(extraInstalled, "extra.txt"), "unexpected\n");

    const exact = spawnSync(
      process.execPath,
      ["scripts/verify-package.mjs", "--installed-path", exactInstalled],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(exact.status, 0, exact.stderr ?? exact.error?.message ?? "");

    mkdirSync(join(exactInstalled, ".codex-plugin"));
    writeFileSync(join(exactInstalled, ".codex-plugin", "host.json"), "{}\n");
    const overlay = spawnSync(
      process.execPath,
      ["scripts/verify-package.mjs", "--installed-path", exactInstalled],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(
      overlay.status,
      0,
      overlay.stderr ?? overlay.error?.message ?? "",
    );

    symlinkSync("plugin.json", join(exactInstalled, "plugin-link"));
    const symlink = spawnSync(
      process.execPath,
      ["scripts/verify-package.mjs", "--installed-path", exactInstalled],
      { cwd: root, encoding: "utf8" },
    );
    assert.notEqual(symlink.status, 0, symlink.stdout ?? "symlink copy passed");
    assert.match(
      symlink.stderr ?? "",
      /symlink outside \.codex-plugin: plugin-link/,
    );

    const extra = spawnSync(
      process.execPath,
      ["scripts/verify-package.mjs", "--installed-path", extraInstalled],
      { cwd: root, encoding: "utf8" },
    );
    assert.notEqual(extra.status, 0, extra.stdout ?? "unexpected copy passed");
    assert.match(extra.stderr ?? "", /unexpected files: extra\.txt/);
  } finally {
    rmSync(exactParent, { recursive: true, force: true });
    rmSync(extraParent, { recursive: true, force: true });
  }
});
