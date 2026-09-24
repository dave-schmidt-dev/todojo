import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";

export const TODOJO_RESOURCE_URI = "ui://todojo/v0.1/todojo.html";

/** Deliberately small v0.1 widget shell; the host owns the initial plan binding. */
const todojoHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ToDoJo</title></head>
<body><main id="todojo" aria-live="polite">ToDoJo</main></body></html>`;

export function registerTodojoResource(server: McpServer): void {
  registerAppResource(
    server,
    "ToDoJo",
    TODOJO_RESOURCE_URI,
    { description: "ToDoJo task-plan widget" },
    () => ({
      contents: [
        {
          uri: TODOJO_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: todojoHtml,
        },
      ],
    }),
  );
}
