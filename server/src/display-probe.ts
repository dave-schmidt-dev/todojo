import { chmodSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { resolveDatabasePath } from "./sqlite-store.js";

const displayModeSchema = z.enum(["inline", "fullscreen", "pip"]);
const probeOutcomeSchema = z.enum(["success", "rejected", "timeout", "error"]);
export const displayProbeRecordSchema = z
  .object({
    timestamp: z.string().max(32),
    advertised: z.array(displayModeSchema).max(3),
    actual: displayModeSchema.nullable(),
    outcome: probeOutcomeSchema,
  })
  .strict();

export type DisplayProbeRecord = z.infer<typeof displayProbeRecordSchema>;

export function resolveProbeFilePath(dbPath?: string): string {
  const targetDb = dbPath ?? resolveDatabasePath();
  return resolve(dirname(targetDb), "pip-probe.json");
}

export function writeProbeRecord(
  record: DisplayProbeRecord,
  dbPath?: string,
): void {
  const checked = displayProbeRecordSchema.parse(record);
  const targetPath = resolveProbeFilePath(dbPath);
  const json = `${JSON.stringify(checked, null, 2)}\n`;
  writeFileSync(targetPath, json, { mode: 0o600, flag: "w" });
  try {
    chmodSync(targetPath, 0o600);
  } catch {
    // ignore platforms without posix permissions
  }
}

export function registerDisplayProbeTool(
  server: McpServer,
  options: { dbPath?: string } = {},
): void {
  let displayProbeClaimed = false;
  server.registerTool(
    "claim_display_probe",
    {
      title: "Claim ToDoJo display probe",
      description:
        "Claim the one automatic display probe for this server session.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    () => {
      const claimed = !displayProbeClaimed;
      displayProbeClaimed = true;
      return {
        structuredContent: { claimed },
        content: [{ type: "text" as const, text: JSON.stringify({ claimed }) }],
      };
    },
  );
  server.registerTool(
    "record_display_probe",
    {
      title: "Record ToDoJo display probe",
      description: "Record bounded diagnostic display mode probe telemetry.",
      inputSchema: displayProbeRecordSchema,
      annotations: { readOnlyHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    (input) => {
      writeProbeRecord(input, options.dbPath);
      return {
        structuredContent: { ok: true },
        content: [
          { type: "text" as const, text: JSON.stringify({ ok: true }) },
        ],
      };
    },
  );
}
