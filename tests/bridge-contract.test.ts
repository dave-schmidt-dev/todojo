import assert from "node:assert/strict";
import { test } from "node:test";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { asPlan, McpAppsBridge, type TodojoPlan } from "../web/src/bridge.ts";

const snapshot: TodojoPlan = {
  plan_id: "plan-from-server",
  as_of: "2026-09-24T12:00:00.000Z",
  work_ms: 0,
  version: 1,
  status: "active",
  tasks: [],
};

test("bridge accepts only structured authoritative plan envelopes", () => {
  assert.equal(asPlan(snapshot)?.plan_id, snapshot.plan_id);
  assert.equal(asPlan({ plan_id: "plan" }), undefined);
  assert.equal(asPlan(undefined), undefined);
  assert.equal(
    asPlan({ ...snapshot, tasks: [{ status: "<img>" }] }),
    undefined,
  );
});

test("context events during connect outrank the initial SDK context", async (t) => {
  let hostChanged: ((context: McpUiHostContext) => void) | undefined;
  t.mock.method(App.prototype, "addEventListener", (event, handler) => {
    if (event === "hostcontextchanged")
      hostChanged = handler as (context: McpUiHostContext) => void;
  });
  t.mock.method(App.prototype, "connect", async () => {
    hostChanged?.({
      displayMode: "pip",
      availableDisplayModes: ["inline", "pip"],
    });
  });
  t.mock.method(App.prototype, "getHostContext", () => ({
    displayMode: "inline",
    availableDisplayModes: ["inline"],
    platform: "desktop",
  }));
  const bridge = new McpAppsBridge();
  const contexts: McpUiHostContext[] = [];
  bridge.onHostContext((context) => contexts.push(context));
  await bridge.connect();
  assert.deepEqual(bridge.getHostContext(), {
    displayMode: "pip",
    availableDisplayModes: ["inline", "pip"],
    platform: "desktop",
  });
  assert.deepEqual(contexts.at(-1), bridge.getHostContext());
});

test("pinned SDK bridge registers toolresult before connect and preserves tool envelope", async (t) => {
  const timeline: string[] = [];
  let toolResult: ((value: unknown) => void) | undefined;
  t.mock.method(App.prototype, "addEventListener", (event, handler) => {
    timeline.push(`listen:${event}`);
    if (event === "toolresult")
      toolResult = handler as (value: unknown) => void;
  });
  t.mock.method(App.prototype, "connect", async () => {
    timeline.push("connect");
  });
  t.mock.method(App.prototype, "callServerTool", async (request) => {
    timeline.push(`call:${request.name}`);
    assert.equal(request.name, "get_task_plan");
    assert.deepEqual(request.arguments, { plan_id: snapshot.plan_id });
    return { content: [], structuredContent: snapshot };
  });

  const bridge = new McpAppsBridge();
  const received: unknown[] = [];
  bridge.onToolResult((value) => received.push(value));
  await bridge.connect();
  assert.deepEqual(timeline.slice(0, 3), [
    "listen:toolresult",
    "listen:hostcontextchanged",
    "connect",
  ]);
  const envelope = { structuredContent: snapshot, content: [] };
  toolResult?.(envelope);
  assert.deepEqual(received, [envelope]);
  assert.deepEqual(await bridge.getPlan(snapshot.plan_id), snapshot);
  assert.deepEqual(timeline.at(-1), "call:get_task_plan");
});

test("SDK handshake declares modes and forwards granted modes and context updates", async (t) => {
  const [hostTransport, appTransport] = InMemoryTransport.createLinkedPair();
  const host = new AppBridge(
    null,
    { name: "test-host", version: "1" },
    {},
    {
      hostContext: {
        displayMode: "inline",
        availableDisplayModes: ["inline", "pip"],
        platform: "mobile",
      },
    },
  );
  const requested: string[] = [];
  host.onrequestdisplaymode = async ({ mode }) => {
    requested.push(mode);
    return { mode: mode === "pip" ? "fullscreen" : "inline" };
  };
  await host.connect(hostTransport);
  const originalConnect = App.prototype.connect;
  let app: App | undefined;
  t.mock.method(App.prototype, "connect", async function (this: App) {
    app = this;
    if (this.options) this.options.autoResize = false;
    await originalConnect.call(this, appTransport);
  });
  const bridge = new McpAppsBridge();
  const contexts: unknown[] = [];
  const unlisten = bridge.onHostContext((context) => contexts.push(context));
  try {
    await bridge.connect();
    assert.deepEqual(host.getAppCapabilities()?.availableDisplayModes, [
      "inline",
      "pip",
    ]);
    assert.equal(bridge.getHostContext()?.displayMode, "inline");
    assert.equal(await bridge.requestDisplayMode("pip"), "fullscreen");
    assert.equal(await bridge.requestDisplayMode("inline"), "inline");
    assert.deepEqual(requested, ["pip", "inline"]);
    await host.sendHostContextChange({ displayMode: "pip" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(bridge.getHostContext()?.displayMode, "pip");
    assert.equal(bridge.getHostContext()?.platform, "mobile");
    assert.deepEqual(bridge.getHostContext()?.availableDisplayModes, [
      "inline",
      "pip",
    ]);
    unlisten();
    const count = contexts.length;
    await host.sendHostContextChange({
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(contexts.length, count);
    assert.equal(bridge.getHostContext()?.displayMode, "inline");
    assert.deepEqual(bridge.getHostContext()?.availableDisplayModes, [
      "inline",
    ]);
  } finally {
    await app?.close();
    await host.close();
  }
});
