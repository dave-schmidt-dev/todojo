import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { resolveLogPath, TodojoLogger } from "./logging.js";
import type { ProgressEvent } from "./progress.js";
import { registerTodojoResource } from "./resource.js";
import {
  type MigrationStartupEvent,
  type SQLiteStoreOptions,
  SQLiteTaskPlanRepository,
} from "./sqlite-store.js";
import {
  registerTodojoTools,
  statusText,
  type ToolRegistrationOptions,
} from "./tools.js";

export const TODOJO_INSTRUCTIONS = `Use ToDoJo positively for substantial multi-step work that benefits from live, explicit task tracking. Do not create a plan for a small one-step task. Create or recover an explicit plan ID with create_task_plan or list_task_plans; never auto-select from a multi-plan list. Start queued work with start_task. If work is blocked, call start_task to resume it before complete_task or advance_task. Use reorder_tasks with every task ID for a full reorder, or queued task IDs only for a queued-subset reorder. Render at most one widget with render_todojo for the requested plan ID; ChatGPT does not load a Codex skill.`;

export interface TodojoServerOptions {
  repository?: SQLiteTaskPlanRepository;
  store?: SQLiteStoreOptions;
  logger?: TodojoLogger;
}

function reportMigrationStartup(event: MigrationStartupEvent): void {
  process.stderr.write(`todojo migration ${event.phase}\n`);
}

/** Creates the stdio-only MCP server and registers the sole ToDoJo resource. */
export function createTodojoServer(options: TodojoServerOptions = {}): {
  server: McpServer;
  repository: SQLiteTaskPlanRepository;
} {
  const providedStatus = options.store?.onMigrationStatus;
  const repository =
    options.repository ??
    new SQLiteTaskPlanRepository({
      ...options.store,
      onMigrationStatus: (event) => {
        providedStatus?.(event);
        reportMigrationStartup(event);
      },
    });
  const logger =
    options.logger ?? new TodojoLogger(resolveLogPath(repository.dbPath));
  const server = new McpServer(
    { name: "todojo", version: "0.1.0" },
    { instructions: TODOJO_INSTRUCTIONS, capabilities: { logging: {} } },
  );
  const onStatus: ToolRegistrationOptions["onStatus"] = (
    event: ProgressEvent,
  ) => {
    if (event.phase === "error") logger.warn(statusText(event));
    else logger.info(statusText(event));
    process.stderr.write(`${statusText(event)}\n`);
    void server
      .sendLoggingMessage({ level: "info", data: statusText(event) })
      .catch(() => undefined);
  };
  registerTodojoTools(server, repository, { onStatus });
  registerTodojoResource(server);
  return { server, repository };
}

/** Starts the MCP stdio binding. Database configuration is validated before connecting. */
export async function runStdio(): Promise<void> {
  const { server, repository } = createTodojoServer();
  const transport = new StdioServerTransport();
  transport.onclose = () => repository.close();
  await server.connect(transport);
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  runStdio().catch((error: unknown) => {
    process.stderr.write(
      `todojo startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
