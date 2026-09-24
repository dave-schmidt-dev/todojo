import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { CallToolResultSchema } from "@modelcontextprotocol/core";
import { App } from "@modelcontextprotocol/ext-apps";
import { McpServer } from "@modelcontextprotocol/server";
import {
  expect as playwrightExpect,
  test as playwrightTest,
} from "@playwright/test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";

const toolResult = {
  content: [{ type: "text", text: "stack probe" }],
};

test("pinned MCP, React, SQLite, Playwright, and build APIs load together", async () => {
  assert.equal(typeof App, "function");
  assert.equal(typeof Client, "function");
  assert.equal(typeof McpServer, "function");
  assert.equal(CallToolResultSchema.safeParse(toolResult).success, true);
  assert.deepEqual(z.object({ ok: z.boolean() }).parse({ ok: true }), {
    ok: true,
  });

  const app = new App({ name: "ToDoJo stack probe", version: "0.1.0" });
  app.addEventListener("toolresult", () => undefined);
  assert.equal(typeof app.addEventListener, "function");
  assert.equal(typeof playwrightTest, "function");
  assert.equal(typeof playwrightExpect, "function");
  assert.equal(
    renderToStaticMarkup(createElement("main", null, "ToDoJo")),
    "<main>ToDoJo</main>",
  );

  const database = new DatabaseSync(":memory:");
  try {
    assert.equal(database.prepare("SELECT 42 AS answer").get()?.answer, 42);
  } finally {
    database.close();
  }

  const bundle = await build({
    stdin: {
      contents: "export const answer: number = 42",
      loader: "ts",
      sourcefile: "stack-probe.ts",
    },
    bundle: true,
    write: false,
  });
  assert.equal(bundle.outputFiles.length, 1);
});
