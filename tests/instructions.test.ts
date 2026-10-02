import assert from "node:assert/strict";
import { test } from "node:test";
import { TODOJO_INSTRUCTIONS } from "../server/src/index.ts";

test("instructions encode activation, blocked resume, reordering, and end-of-turn render rules", () => {
  for (const phrase of [
    "substantial multi-step work",
    "small one-step task",
    "never auto-select",
    "start_task to resume",
    "full reorder",
    "queued-subset reorder",
    "call create_task_plan once",
    "starts the first task by default",
    "reuse that same plan ID",
    "LAST tool call before each user-facing turn-ending response",
    "including a blocked handoff and completion",
    "appends a fresh view of the same plan",
    "cannot move or delete earlier cards",
    "ChatGPT does not load a Codex skill",
  ]) {
    assert.match(TODOJO_INSTRUCTIONS, new RegExp(phrase));
  }
});

test("instructions require a same-plan end-of-turn refresh and prohibit stale never-render bans", () => {
  assert.match(
    TODOJO_INSTRUCTIONS,
    /call read-only render_todojo once with that explicit plan ID as the LAST tool call/,
  );
  assert.match(
    TODOJO_INSTRUCTIONS,
    /Do not re-render after every transition, poll, or commentary\./,
  );
  assert.doesNotMatch(
    TODOJO_INSTRUCTIONS,
    /do not call render_todojo again after creation/,
  );
  assert.doesNotMatch(TODOJO_INSTRUCTIONS, /never render again after creation/);
  assert.doesNotMatch(TODOJO_INSTRUCTIONS, /Render at most one/);
});
