import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

const maxLogBytes = 1_000_000;

/** Keep logs with the configured database, using the project root for `.data`. */
export function resolveLogPath(dbPath: string): string {
  const configured = process.env.TODOJO_LOG_PATH;
  if (configured) {
    if (!isAbsolute(configured)) {
      throw new Error("TODOJO_LOG_PATH must be absolute");
    }
    return configured;
  }
  const dbDirectory = dirname(dbPath);
  const logRoot =
    basename(dbDirectory) === ".data" ? dirname(dbDirectory) : dbDirectory;
  return join(logRoot, ".logs", "todojo.log");
}

/** Small rotating file logger; ordinary runs persist WARNING and ERROR only. */
export class TodojoLogger {
  private readonly debugEnabled: boolean;

  constructor(
    private readonly path: string,
    debugEnabled = process.argv.includes("--debug"),
  ) {
    if (!isAbsolute(path)) throw new Error("ToDoJo log path must be absolute");
    this.debugEnabled = debugEnabled;
    mkdirSync(dirname(path), { recursive: true });
  }

  info(message: string, fields: Record<string, unknown> = {}): void {
    if (this.debugEnabled) this.write("DEBUG", message, fields);
  }

  warn(message: string, fields: Record<string, unknown> = {}): void {
    this.write("WARN", message, fields);
  }

  error(message: string, fields: Record<string, unknown> = {}): void {
    this.write("ERROR", message, fields);
  }

  private write(
    level: "DEBUG" | "WARN" | "ERROR",
    message: string,
    fields: Record<string, unknown>,
  ): void {
    try {
      this.rotateIfNeeded();
      appendFileSync(
        this.path,
        `${new Date().toISOString()} ${level} ${message} ${JSON.stringify(fields)}\n`,
        "utf8",
      );
    } catch {
      // Logging must never corrupt an MCP response or leak to stdout.
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (statSync(this.path).size >= maxLogBytes) {
        renameSync(this.path, `${this.path}.1`);
      }
    } catch {
      // A missing file is the normal first-run case.
    }
  }
}
