import assert from "node:assert/strict";
import { test } from "node:test";
import { TODOJO_INSTRUCTIONS } from "../server/src/index.ts";

test("instructions encode activation, blocked resume, reordering, and one-render rules", () => {
  for (const phrase of [
    "substantial multi-step work",
    "small one-step task",
    "never auto-select",
    "start_task to resume",
    "full reorder",
    "queued-subset reorder",
    "Render at most one",
    "ChatGPT does not load a Codex skill",
  ]) {
    assert.match(TODOJO_INSTRUCTIONS, new RegExp(phrase));
  }
});
