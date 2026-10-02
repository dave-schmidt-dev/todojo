import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import {
  displayProbeRecordSchema,
  registerDisplayProbeTool,
  resolveProbeFilePath,
  writeProbeRecord,
} from "../server/src/display-probe.js";
import { asPlan } from "../web/src/bridge.js";
import {
  type DisplayProbeHost,
  type DisplayProbeResult,
  executeDisplayProbe,
  recordProbeTelemetry,
} from "../web/src/display-probe.js";

const testDir = mkdtempSync(join(tmpdir(), "todojo-probe-test-"));
after(() => rmSync(testDir, { recursive: true, force: true }));

test("genuine request despite missing advertised pip", async () => {
  const requestedModes: string[] = [];
  const host: DisplayProbeHost = {
    getHostContext: () => ({ availableDisplayModes: ["inline"] }),
    requestDisplayMode: async ({ mode }) => {
      requestedModes.push(mode);
      return { mode: "inline" };
    },
  };

  const result = await executeDisplayProbe(host);
  assert.deepEqual(requestedModes, ["pip"]);
  assert.deepEqual(result.advertised, ["inline"]);
  assert.equal(result.actual, "inline");
  assert.equal(result.outcome, "rejected");
});

test("actual inline rejection does not report success", async () => {
  const host: DisplayProbeHost = {
    getHostContext: () => ({ availableDisplayModes: ["inline"] }),
    requestDisplayMode: async () => ({ mode: "inline" }),
  };

  const result = await executeDisplayProbe(host);
  assert.equal(result.actual, "inline");
  assert.equal(result.outcome, "rejected");
  assert.notEqual(result.outcome, "success");
});

test("success pip returns actual pip and success outcome", async () => {
  const host: DisplayProbeHost = {
    getHostContext: () => ({ availableDisplayModes: ["inline", "pip"] }),
    requestDisplayMode: async () => ({ mode: "pip" }),
  };

  const result = await executeDisplayProbe(host);
  assert.equal(result.actual, "pip");
  assert.equal(result.outcome, "success");
});

test("timeout <= 8s yields timeout outcome and null actual", async () => {
  const host: DisplayProbeHost = {
    requestDisplayMode: () =>
      new Promise((resolve) => setTimeout(() => resolve({ mode: "pip" }), 100)),
  };

  const result = await executeDisplayProbe(host, { timeoutMs: 15 });
  assert.equal(result.actual, null);
  assert.equal(result.outcome, "timeout");
});

test("errors yield error outcome and null actual", async () => {
  const host: DisplayProbeHost = {
    requestDisplayMode: async () => {
      throw new Error("host rejected display mode change");
    },
  };

  const result = await executeDisplayProbe(host);
  assert.equal(result.actual, null);
  assert.equal(result.outcome, "error");
});

test("telemetry failure is distinct from display request success", async () => {
  const host: DisplayProbeHost = {
    requestDisplayMode: async () => ({ mode: "pip" }),
    callServerTool: async () => {
      throw new Error("server telemetry unavailable");
    },
  };

  const result = await executeDisplayProbe(host);
  assert.equal(result.outcome, "success");
  assert.equal(result.actual, "pip");

  const telemetrySaved = await recordProbeTelemetry(host, result);
  assert.equal(telemetrySaved, false);
});

test("telemetry timeout and MCP error envelopes are reported as failures", async () => {
  const result: DisplayProbeResult = {
    timestamp: new Date().toISOString(),
    advertised: ["inline"],
    actual: "pip",
    outcome: "success",
  };
  const started = Date.now();
  const timedOut = await recordProbeTelemetry(
    {
      requestDisplayMode: async () => ({ mode: "pip" }),
      callServerTool: () => new Promise(() => {}),
    },
    result,
  );
  assert.equal(timedOut, false);
  assert.ok(Date.now() - started <= 3_200);

  const errorEnvelope = await recordProbeTelemetry(
    {
      requestDisplayMode: async () => ({ mode: "pip" }),
      callServerTool: async () => ({ isError: true }),
    },
    result,
  );
  assert.equal(errorEnvelope, false);
});

test("telemetry sanitization, private 0600 mode, and truncation", () => {
  const dbPath = join(testDir, "test.sqlite");
  const probeFile = resolveProbeFilePath(dbPath);

  const validRecord = {
    timestamp: new Date().toISOString(),
    advertised: ["inline" as const],
    actual: "inline" as const,
    outcome: "rejected" as const,
  };

  // Extra unauthorized fields must be rejected by zod strict validation
  assert.throws(() => {
    displayProbeRecordSchema.parse({
      ...validRecord,
      task_title: "Secret Task Data",
      db_path: "/etc/passwd",
      raw_error: "stack trace",
      api_key: "secret-token",
    });
  });

  // Write first record
  writeProbeRecord(validRecord, dbPath);
  const fileStat = statSync(probeFile);
  // Mode 0600 check (owner read/write only)
  assert.equal(fileStat.mode & 0o777, 0o600);

  const initialContent = JSON.parse(readFileSync(probeFile, "utf8"));
  assert.deepEqual(initialContent, validRecord);
  assert.equal(Object.keys(initialContent).length, 4);

  // Write second record (explicit retry) - must truncate to only the latest record
  const updatedRecord = {
    timestamp: new Date().toISOString(),
    advertised: ["inline" as const, "pip" as const],
    actual: "pip" as const,
    outcome: "success" as const,
  };
  writeProbeRecord(updatedRecord, dbPath);

  const updatedContent = JSON.parse(readFileSync(probeFile, "utf8"));
  assert.deepEqual(updatedContent, updatedRecord);
});

test("SDK callServerTool response does not corrupt plan data", () => {
  const toolResult = { ok: true };
  assert.equal(asPlan(toolResult), undefined);
  assert.equal(asPlan({ structuredContent: toolResult }), undefined);
});

test("automatic PiP claim succeeds once per registered server session", async () => {
  const server = new McpServer(
    { name: "claim-test-server", version: "0.2.1" },
    { instructions: "test" },
  );
  registerDisplayProbeTool(server, { dbPath: join(testDir, "claim.sqlite") });
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "claim-test-client", version: "0.1.0" });
  await client.connect(clientTransport);
  try {
    const first = await client.callTool({
      name: "claim_display_probe",
      arguments: {},
    });
    const second = await client.callTool({
      name: "claim_display_probe",
      arguments: {},
    });
    assert.deepEqual(first.structuredContent, { claimed: true });
    assert.deepEqual(second.structuredContent, { claimed: false });
    const tools = await client.listTools();
    const claimTool = tools.tools.find(
      (tool) => tool.name === "claim_display_probe",
    );
    assert.equal(claimTool?.outputSchema, undefined);
    assert.deepEqual(
      (claimTool?._meta as { ui?: { visibility?: string[] } } | undefined)?.ui
        ?.visibility,
      ["app"],
    );
    const invalid = await client.callTool({
      name: "claim_display_probe",
      arguments: { extra: true },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("server registers record_display_probe with app-only visibility and mutation annotation", async () => {
  const dbPath = join(testDir, "server-test.sqlite");
  const server = new McpServer(
    { name: "test-server", version: "0.2.1" },
    { instructions: "test" },
  );
  registerDisplayProbeTool(server, { dbPath });

  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await client.connect(clientTransport);

  try {
    const list = await client.listTools();
    const probeTool = list.tools.find((t) => t.name === "record_display_probe");
    assert.ok(probeTool, "record_display_probe must be registered");
    assert.equal(
      probeTool.annotations?.readOnlyHint,
      false,
      "annotations must accurately reflect mutation",
    );
    assert.deepEqual(
      (probeTool._meta as { ui?: { visibility?: string[] } })?.ui?.visibility,
      ["app"],
      "visibility must be app-only where ext-apps supports it",
    );

    const record: DisplayProbeResult = {
      timestamp: new Date().toISOString(),
      advertised: ["inline"],
      actual: "inline",
      outcome: "rejected",
    };

    const callResult = await client.callTool({
      name: "record_display_probe",
      arguments: record,
    });
    assert.deepEqual(callResult.structuredContent, { ok: true });

    const probeFile = resolveProbeFilePath(dbPath);
    const saved = JSON.parse(readFileSync(probeFile, "utf8"));
    assert.deepEqual(saved, record);
  } finally {
    await client.close();
    await server.close();
  }
});
