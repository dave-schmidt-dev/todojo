import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";

export const TODOJO_RESOURCE_URI = "ui://todojo/v0.2/todojo.html";

declare const __TODOJO_BUNDLE__: string;
const todojoBundle =
  typeof __TODOJO_BUNDLE__ === "string" ? __TODOJO_BUNDLE__ : "";
const todojoHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ToDoJo</title></head><body><main id="todojo"></main><script>${todojoBundle}</script></body></html>`;

export function registerTodojoResource(server: McpServer): void {
  registerAppResource(
    server,
    "ToDoJo",
    TODOJO_RESOURCE_URI,
    {
      description: "ToDoJo task-plan widget",
      _meta: { ui: { prefersBorder: true } },
    },
    () => ({
      contents: [
        {
          uri: TODOJO_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: todojoHtml,
          _meta: {
            ui: { prefersBorder: true },
            "openai/ui": { availableDisplayModes: ["inline", "pip"] },
          },
        },
      ],
    }),
  );
}
