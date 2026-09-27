---
name: todojo
description: "Use ToDoJo for substantial multi-step work, even when it is not mentioned: multi-file implementation, debugging requiring diagnosis and tests, research with a deliverable, or multi-stage audits. Skip trivial one-step or factual requests."
---

Use ToDoJo for substantial multi-step work, or when the user explicitly asks for a plan. Do not create a plan for a trivial one-step request.

1. Create a plan or recover an explicit `plan_id`; never choose among multiple plans implicitly.
2. Before working a planned task, call `start_task`. If a task is blocked, call `start_task` to resume it before `complete_task` or `advance_task`.
3. Prefer `advance_task` to atomically complete the active task and start the next task. Use `complete_task` only when no next task should start.
4. Mark blocked only for a genuine external dependency, user action, unavailable credential, device, or service. Keep ordinary test, compiler, and runtime failures active while fixing them.
5. Preserve display IDs. For a full reorder, send every task ID in the desired order. For a partial reorder, send only queued task IDs; their existing queued slots are reordered.
6. Keep titles concise and action-oriented. Add or reorder work only when the actual plan changes.
7. Render exactly one `render_todojo` widget after establishing the requested plan. Do not render again after each transition.
8. Keep the plan synchronized with real work and provide visible progress while work is ongoing. Snapshots and tool results are authoritative; do not invent UI state.
