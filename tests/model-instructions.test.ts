import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { TODOJO_INSTRUCTIONS } from "../server/src/index.ts";

const skill = readFileSync(resolve("skills/todojo/SKILL.md"), "utf8");

test("plugin skill binds plans and covers ToDoJo transition rules", () => {
  for (const phrase of [
    "substantial multi-step work",
    "explicit `plan_id`",
    "call `start_task` to resume it before `complete_task` or `advance_task`",
    "full reorder",
    "partial reorder",
    "genuine external dependency",
    "call `create_task_plan` once",
    "do not call `render_todojo` again immediately after creation",
    "LAST tool call before each user-facing turn-ending response",
    "including a blocked handoff and completion",
    "appends a fresh view of the same plan",
    "cannot move or delete earlier cards",
    "visible progress",
  ]) {
    assert.match(
      skill,
      new RegExp(phrase.replaceAll(/[.*+?^${}()|[\\]\\]/g, "\\$&")),
    );
  }
});

test("skill requires a same-plan end-of-turn refresh and prohibits stale never-render bans", () => {
  assert.match(
    skill,
    /call read-only `render_todojo` once with that explicit `plan_id`/,
  );
  assert.match(
    skill,
    /Do not re-render after every transition, poll, or commentary\./,
  );
  assert.doesNotMatch(
    skill,
    /do not call `render_todojo` again after creation/,
  );
  assert.doesNotMatch(skill, /Do not render again after each transition\./);
  assert.doesNotMatch(skill, /render exactly one/);
});

test("server instructions retain the skill's enforceable workflow constraints", () => {
  for (const phrase of [
    "never auto-select",
    "start_task to resume",
    "full reorder",
    "queued-subset reorder",
    "LAST tool call before each user-facing turn-ending response",
    "including a blocked handoff and completion",
  ]) {
    assert.match(TODOJO_INSTRUCTIONS, new RegExp(phrase));
  }
});
