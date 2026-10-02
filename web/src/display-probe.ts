export type DisplayMode = "inline" | "fullscreen" | "pip";
type CategoricalOutcome = "success" | "rejected" | "timeout" | "error";
type ProbeStatus = "idle" | "pending" | "returned" | "failure";

export interface DisplayProbeResult {
  timestamp: string;
  advertised: DisplayMode[];
  actual: DisplayMode | null;
  outcome: CategoricalOutcome;
}

export interface DisplayProbeState {
  status: ProbeStatus;
  result?: DisplayProbeResult;
  currentMode: DisplayMode;
  telemetryFailed?: boolean;
}

export interface DisplayProbeHost {
  getHostContext?():
    | {
        availableDisplayModes?: unknown;
        displayMode?: unknown;
      }
    | undefined;
  requestDisplayMode(params: { mode: DisplayMode }): Promise<{ mode: string }>;
  callServerTool?(request: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface ProbeOptions {
  timeoutMs?: number;
}

const validModes = new Set<DisplayMode>(["inline", "fullscreen", "pip"]);

function normalizeDisplayModes(raw: unknown): DisplayMode[] {
  if (!Array.isArray(raw)) return ["inline"];
  const filtered = raw.filter(
    (item): item is DisplayMode =>
      typeof item === "string" && validModes.has(item as DisplayMode),
  );
  return filtered.length > 0 ? filtered : ["inline"];
}

export function normalizeDisplayMode(raw: unknown): DisplayMode | null {
  if (typeof raw === "string" && validModes.has(raw as DisplayMode)) {
    return raw as DisplayMode;
  }
  return null;
}

/**
 * Bounded diagnostic PiP display mode probe.
 * Makes exactly one SDK requestDisplayMode({mode:'pip'}), even if host advertises inline only.
 * Normalizes result: records advertised modes, returned actual mode, and safe categorical outcome.
 * Does not report success merely because request fulfilled.
 * Times out in <=8 seconds (default 8,000ms).
 */
export async function executeDisplayProbe(
  host: DisplayProbeHost,
  options: ProbeOptions = {},
): Promise<DisplayProbeResult> {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 8_000, 1), 8_000);
  const context = host.getHostContext?.();
  const advertised = normalizeDisplayModes(context?.availableDisplayModes);
  const timestamp = new Date().toISOString();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const requestPromise = host.requestDisplayMode({ mode: "pip" });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("PROBE_TIMEOUT")), timeoutMs);
    });

    const response = await Promise.race([requestPromise, timeoutPromise]);
    const actual = normalizeDisplayMode(response?.mode);
    const outcome: CategoricalOutcome =
      actual === "pip" ? "success" : "rejected";

    return {
      timestamp,
      advertised,
      actual,
      outcome,
    };
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.message === "PROBE_TIMEOUT";
    return {
      timestamp,
      advertised,
      actual: null,
      outcome: isTimeout ? "timeout" : "error",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Records telemetry via SDK callServerTool after request.
 * Telemetry failure is captured distinctly from display request success.
 */
export async function recordProbeTelemetry(
  host: DisplayProbeHost,
  result: DisplayProbeResult,
): Promise<boolean> {
  if (!host.callServerTool) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      host.callServerTool({
        name: "record_display_probe",
        arguments: {
          timestamp: result.timestamp,
          advertised: result.advertised,
          actual: result.actual,
          outcome: result.outcome,
        },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("TELEMETRY_TIMEOUT")), 3_000);
      }),
    ]);
    return !(
      typeof response === "object" &&
      response !== null &&
      "isError" in response &&
      response.isError === true
    );
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
