/** Events a caller can surface while synchronous SQLite work is in progress. */
type ProgressPhase = "pending" | "result" | "error";

export interface ProgressEvent {
  operation: string;
  phase: ProgressPhase;
  error?: string;
}

export type StatusCallback = (event: ProgressEvent) => void;

export function withProgress<T>(
  operation: string,
  status: StatusCallback | undefined,
  work: () => T,
): T {
  status?.({ operation, phase: "pending" });
  try {
    const result = work();
    status?.({ operation, phase: "result" });
    return result;
  } catch (error) {
    status?.({
      operation,
      phase: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
