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
    "Render exactly one",
    "visible progress",
  ]) {
    assert.match(
      skill,
      new RegExp(phrase.replaceAll(/[.*+?^${}()|[\\]\\]/g, "\\$&")),
    );
  }
  assert.match(skill, /Do not render again after each transition\./);
});

test("server instructions retain the skill's enforceable workflow constraints", () => {
  for (const phrase of [
    "never auto-select",
    "start_task to resume",
    "full reorder",
    "queued-subset reorder",
    "Render at most one",
  ]) {
    assert.match(TODOJO_INSTRUCTIONS, new RegExp(phrase));
  }
});
