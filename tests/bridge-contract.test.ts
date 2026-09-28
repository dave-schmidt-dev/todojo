import assert from "node:assert/strict";
import { test } from "node:test";
import { App } from "@modelcontextprotocol/ext-apps";
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
  assert.deepEqual(timeline.slice(0, 2), ["listen:toolresult", "connect"]);
  const envelope = { structuredContent: snapshot, content: [] };
  toolResult?.(envelope);
  assert.deepEqual(received, [envelope]);
  assert.deepEqual(await bridge.getPlan(snapshot.plan_id), snapshot);
  assert.deepEqual(timeline.at(-1), "call:get_task_plan");
});
