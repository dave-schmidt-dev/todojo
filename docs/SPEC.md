> Naming amendment, 2026-09-24: David selected **ToDoJo** for this to-do tool. This specification retains the original behavior and replaces the former display name and code identifiers. The original packet is preserved in the task attachment.

# TODOJO v0.1 BUILD + TEST PACKET

## Product

Name: ToDoJo
Package ID: todojo
Version: 0.1.0
Category: Productivity

Short description:
Live, numbered task tracking for substantial ChatGPT and Codex work.

Long description:
ToDoJo gives ChatGPT and Codex a persistent structured task plan with stable
task IDs, accurate timers, explicit state transitions, and an interactive inline
progress view. It is intended for substantial multi-step work where users want
to know what was just completed, what is being worked on now, what comes next,
and how long the work is taking.

Tagline:
See the work while it happens.

This plugin is intended to eventually be published beside the existing Advisor
plugin.

Do not design ToDoJo as a replacement for project management software.
It is a live work-status layer for AI-assisted tasks.


# 1. V0.1 GOAL

Build a locally installable ToDoJo plugin that can:

1. Create a structured task plan.
2. Maintain stable T# identifiers.
3. Track an authoritative current task.
4. Track accurate task work time.
5. Track accurate overall active-work time.
6. Complete, block, resume, skip, reorder, and advance tasks.
7. Render one interactive inline ToDoJo widget.
8. Offer distinct Full and Compact views.
9. Persist state through widget reloads.
10. Reliably instruct ChatGPT/Codex to maintain task state while doing
    substantial multi-step work.

The goal of v0.1 is BUILD + LOCAL TESTING.

Do not optimize v0.1 for public marketplace submission yet.


# 2. NON-GOALS FOR V0.1

Do not add:

- team collaboration
- shared plans
- cloud accounts
- notifications
- mobile-specific UI
- kanban views
- arbitrary project-management features
- inferred project metadata
- inferred workflow phases
- LLM-generated status labels not backed by state
- decorative metadata
- multiple simultaneously active tasks
- public production hosting
- marketplace submission automation

Keep v0.1 small and deterministic.


# 3. CORE DESIGN RULE

THE UI MUST NEVER INVENT STATE.

Every dynamic value visible in ToDoJo must come from authoritative server state.

Examples:

Allowed:
- T6
- active
- blocked
- 4:12
- 5 completed
- 7 queued
- plan title explicitly stored on the plan

Not allowed:
- "CODING" because the UI guessed the phase
- "Plan stable"
- inferred repository names
- inferred project titles
- fake progress percentages
- guessed timestamps

If a value is unknown, omit it.


# 4. TASK IDENTIFIERS

Every task receives a stable sequential display ID:

T1
T2
T3
...

IDs are permanent.

If T7 is skipped or cancelled, T7 is never reused.

Internal storage may use UUIDs, but the user-facing ID must remain stable.

Example:

{
  "id": "uuid",
  "display_id": "T7"
}


# 5. TASK STATES

Required states:

queued
active
blocked
completed
skipped

Semantic colors:

completed = green
active = blue
queued = amber
blocked = red
skipped = neutral gray with strike-through

Red MUST mean genuinely blocked.

Do not use red for:
- compilation failures being actively fixed
- failed tests being actively investigated
- normal retries
- ordinary implementation errors

Blocked means useful progress cannot continue without an external dependency,
user action, unavailable resource, credential, device, service, etc.


# 6. SINGLE ACTIVE TASK

v0.1 permits a maximum of ONE active task per plan.

start_task must reject an attempt to start another task if one is already active.

The normal transition between tasks should use advance_task so completion of one
task and activation of the next occur atomically.


# 7. TIMER MODEL

Do not implement timers as UI-only JavaScript counters.

Persist timestamp intervals on the server.

Each task should support one or more active intervals:

[
  {
    "started_at": "...",
    "ended_at": "..."
  }
]

This supports:

active -> blocked -> active -> completed

Task active duration:

sum(all closed active intervals)
+
current_time - open interval start

Blocked time does NOT count.

Skipped time does NOT count.

Queued time does NOT count.


## Overall work timer

Overall WORK time is:

sum(active intervals across every task in the plan)

Because v0.1 allows only one active task at once, this represents genuine active
work without double-counting.

Example:

T1  1:18
T2  2:41
T3  3:06
T4  2:57
T5  4:12
T6 active 2:14

WORK = sum of all active intervals.

If the current task becomes blocked and nothing else is active, WORK freezes.

This timer must survive:
- widget remount
- ChatGPT reload
- MCP reconnect
- switching Full/Compact views


# 8. SERVER DATA MODEL

Plan:

{
  plan_id: UUID,
  title?: string,
  created_at: ISO timestamp,
  updated_at: ISO timestamp,
  version: integer,
  next_task_number: integer,
  status: "active" | "completed",
  tasks: Task[]
}

Task:

{
  id: UUID,
  display_id: "T6",
  title: string,
  description?: string,
  order: integer,
  status: "queued" | "active" | "blocked" | "completed" | "skipped",
  block_reason?: string,
  created_at: ISO timestamp,
  completed_at?: ISO timestamp,
  skipped_at?: ISO timestamp,
  intervals: [
    {
      started_at: ISO timestamp,
      ended_at?: ISO timestamp
    }
  ]
}

Every mutation increments plan.version.


# 9. STORAGE

For v0.1 use SQLite.

Requirements:

- state survives MCP server restart
- timestamps stored in UTC
- transaction around every state transition
- advance_task must be atomic
- task numbers allocated transactionally
- no reuse of display IDs

Abstract persistence behind a repository interface so SQLite can later be
replaced by a hosted durable database without rewriting the MCP tools.


# 10. MCP TOOLS

Implement clear, narrow tools.

## create_task_plan

Input:
{
  title?: string,
  start_first?: boolean, // defaults to true
  tasks: [
    {
      title: string,
      description?: string
    }
  ]
}

Behavior:
- create plan
- allocate T1...
- start T1 within the create transaction by default; explicit start_first=false keeps tasks queued
- return the authoritative snapshot and mount one widget from this result


## get_task_plan

Input:
{
  plan_id: string
}

Returns complete authoritative snapshot.


## add_task

Input:
{
  plan_id: string,
  title: string,
  description?: string,
  after_task_id?: string
}

Allocate a NEW T#.
Never renumber existing tasks.


## start_task

Input:
{
  plan_id: string,
  task_id: string
}

Rules:
- reject if another task is active
- open a timing interval
- queued or blocked -> active
- clear block reason when resuming


## complete_task

Input:
{
  plan_id: string,
  task_id: string
}

Rules:
- task must be active
- close timing interval
- mark completed
- set completed_at


## advance_task

Input:
{
  plan_id: string,
  complete_task_id: string,
  start_task_id: string
}

Use ONE server timestamp.

At the exact same timestamp:

complete_task_id active interval ends
complete_task_id becomes completed

start_task_id active interval begins
start_task_id becomes active

This is the preferred ordinary transition tool.


## block_task

Input:
{
  plan_id: string,
  task_id: string,
  reason: string
}

Rules:
- close active interval if active
- set blocked
- require a concise block reason


## skip_task

Input:
{
  plan_id: string,
  task_id: string,
  reason?: string
}

Rules:
- close active interval if needed
- mark skipped
- never reuse its T#


## reorder_tasks

Input:
{
  plan_id: string,
  ordered_task_ids: string[]
}

Only change order.

NEVER alter display IDs.


# 11. UI ARCHITECTURE

Use MCP Apps UI.

New work calls create_task_plan once to create, start T1, and mount the widget.
Do not call render_todojo after creation. For resume or recovery, use the
read-only dedicated render tool with an explicit plan ID:

render_todojo

Input:
{
  plan_id: string
}

create_task_plan and render_todojo share the ToDoJo UI resource. Other mutation
tools return structured data and do not mount another widget.

Keep visible requests the MCP Apps host pip mode on a user click when
availableDisplayModes includes pip. App initialization and OpenAI resource
metadata declare inline and pip support. Full/Compact is independent of host
placement. Show pending feedback and the actual granted mode, including
fullscreen fallback, inline denial, and errors. Host context changes update
the control; Return to chat requests inline when supported. A completed plan
requests inline once if it is outside chat, with completion still visible on
denial or error. Polling remains bound to the same plan throughout.

UI resource URI should be versioned, e.g.:

ui://todojo/v0.1/todojo.html


# 12. LIVE UPDATES

The mounted ToDoJo component should periodically retrieve the latest
authoritative snapshot.

For v0.1:

- use MCP Apps tools/call
- call get_task_plan
- approximately every 2 seconds while plan is active
- reduce frequency or stop when plan is complete
- immediately refresh after a user-triggered interaction
- compare plan.version before rerendering

Do not recreate/remount the widget for every state change.

Presentation-only state remains local:
- Full vs Compact
- selected task
- open drawer

Business state always comes from MCP.


# 13. HEADER

Keep the header dense: LIVE TASKS, the authoritative plan title when present,
WORK time, and the mode switch. Do not invent a plan title. Queue and completed
counts sit in the Full footer or the Compact count control.


# 14. FULL VIEW

Full uses the available width for a three-column row: the focus task followed
by up to two queued tasks. The focus column is wider than either queued column.
The focus is the active or blocked task, or the latest completed task when no
work is current. When no queued tasks remain, show up to two recent completed
tasks without repeating the focus. Sparse plans do not render empty task tiles.

Show the task title, status, timer, description when one exists, and blocked
reason when one exists. Do not reserve space for missing descriptions. The
footer gives exact queued and completed counts; each count opens its drawer.

At narrow widths the focus spans the row above two task columns. No layout
may cause page-level horizontal scrolling.


# 15. TITLE SIZING

Do NOT truncate normal titles simply because one is longer.

Do NOT shrink long titles to unreadable sizes.

Use bounded auto-fit:

max approximately 17px
min approximately 13px
maximum 2 lines

Prefer measuring actual rendered height instead of estimating from character
count.

Algorithm:

1. render title at max size
2. if it exceeds 2-line content box, reduce by 0.5px
3. stop when it fits
4. never go below minimum
5. if still too long at minimum, clamp to 2 lines
6. full title remains accessible through task details / aria-label

Short titles should be visibly larger than long titles.


# 16. ACTIVE TASK ANIMATION

Only animate the blue active-status DOT.

Use a subtle breathing animation.

Do NOT:
- pulse the entire card
- blink
- animate borders continuously
- use glowing gradients

Animation means:
"work is happening now"

Respect prefers-reduced-motion.


# 17. COMPACT VIEW

Compact is one status row with the same focus task as Full: status, T number,
title, and timer. The title may truncate visually; its full text is in the
button label and task detail drawer. A single count button opens the queued
tasks when any remain, or history when the queue is empty. The mode switch,
plan title, and WORK timer remain in the header. No queued or recent task cards
appear in the Compact row.


# 18. COUNTS AND DRAWERS

Queued counts include currently queued tasks only. Completed counts include
completed tasks only. Skipped tasks remain in history but are not counted as
completed; a blocked current task is not queued. Full exposes both queue and
history drawers. Compact exposes the queue while one exists and history when
there are no queued tasks. Drawer controls are native buttons and toggle open
or closed.


# 19. CLICK BEHAVIOR

Every task card is clickable.

Click once:
open detail drawer.

Click same card again:
close detail drawer.

Click another card:
replace current drawer contents with that card.

Drawer also has × close control.

Selected card gets a subtle selected outline.

No navigation away from conversation.


# 20. TASK DETAIL DRAWER

For completed task show:

T5 · Trace episode state
Completed
Duration: 4:12

Description:
...

For active:

T6 · Consolidate state model
Active
Elapsed active time: 2:14

Description:
...

For blocked:

T6 · Device synchronization
Blocked
Active work before block: 3:24

Waiting for physical device.

For queued:
title + description + queue position.

Do not expose internal UUID unless debugging mode is enabled.


# 21. BLOCKED STATE

Blocked card becomes red.

Example:

BLOCKED · T6             3:24
⚠ Device synchronization

Waiting for physical device

The task timer freezes.
The WORK timer freezes if nothing else is active.
Breathing dot stops.

Blocked reason is authoritative server state.


# 22. SKIPPED STATE

Skipped tasks:

- gray
- strike-through
- timer frozen
- T# retained forever

They should normally disappear from the Full active window and remain available
through plan/history detail.

Do not treat skipped as failure.


# 23. PLAN CHANGES

If tasks are added/reordered/skipped while widget is visible:

- update based on plan.version
- transition cards subtly
- no flashy animation

Optional temporary toast:

Plan updated

Do NOT display permanent labels such as:
"Plan stable"


# 24. MODEL SKILL

Create:

skills/todojo/SKILL.md

The skill must tell ChatGPT/Codex:

ToDoJo is for substantial multi-step work.

When a ToDoJo plan is active:

1. Keep the plan synchronized with actual work.
2. Before starting a planned unit of work, ensure it is active.
3. Prefer advance_task when completing one task and beginning another.
4. Complete a task only when its stated work is actually complete.
5. Use blocked only when progress truly cannot continue.
6. Do not mark ordinary test/compiler/runtime failures as blocked while actively
   fixing them.
7. Add or reorder tasks when the plan genuinely changes.
8. Preserve task IDs.
9. Keep task titles concise and action-oriented.
10. Never invent UI metadata.
11. Create and render new work in one create_task_plan call; render_todojo once
    with an explicit plan ID only for resume or recovery.
12. Do not render a new widget after every task transition.
13. For trivial one-step questions, do not create a ToDoJo plan unless the
    user explicitly asks for one.

The MCP server remains authoritative.


# 25. FILE STRUCTURE

todojo/
├── plugin.json
├── README.md
├── docs/
│   ├── SPEC.md
│   └── TEST-PLAN.md
├── skills/
│   └── todojo/
│       └── SKILL.md
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── tools.ts
│       ├── model.ts
│       ├── store.ts
│       ├── sqlite-store.ts
│       └── timers.ts
├── web/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── component.tsx
│       ├── bridge.ts
│       ├── task-grid.tsx
│       └── styles.css
├── tests/
│   ├── state-transitions.test.ts
│   ├── timers.test.ts
│   ├── ids.test.ts
│   ├── persistence.test.ts
│   └── tools.test.ts
└── evals/
    ├── activation.md
    ├── workflow.md
    └── negative.md


# 26. PLUGIN MANIFEST

Use the current portable root plugin.json format.

Initial values:

name: todojo
version: 0.1.0
description: Live numbered task tracking for substantial ChatGPT and Codex work.

OpenAI interface displayName:
ToDoJo

Category:
Productivity

Do not hand-invent registered MCP application IDs.

Use the current OpenAI plugin tooling / plugin-creator workflow when wiring the
registered MCP server into the package.


# 27. LOCAL TESTING

Test server functionality independently first.

Then test complete plugin from a local marketplace.

Use a new conversation for clean activation testing.

Keep an eval set and record failures.

Test at minimum:

STATE
- create 1 task
- create 50 tasks
- T numbers sequential
- deleted/skipped numbers never reused
- only one task active
- invalid transitions rejected
- advance_task atomic

TIMERS
- active timer increments
- blocked timer freezes
- resume continues accumulated active time
- complete freezes final duration
- WORK equals sum of active intervals
- server restart preserves timers
- widget remount preserves timers

UI
- three-column Full row with a wider focus task
- Compact is a single current-status row
- no horizontal scroll at narrow widths
- accurate queue and history controls
- bounded title auto-fit
- active dot breathes
- reduced-motion disables animation
- click task opens drawer
- click same task closes drawer
- click another replaces drawer
- × closes drawer
- history count opens history
- queue count opens queue
- blocked state red
- skipped state gray/struck

MODEL COMPLIANCE
- model creates plan for substantial work
- does not create plan for simple factual question
- starts task before working it
- advances tasks
- records true blocks
- does not misuse blocked for normal failures
- updates changed plans
- does not invent metadata
- does not spawn repeated widgets

PERSISTENCE
- restart server
- reload ChatGPT
- remount widget
- reconnect MCP
- all authoritative state remains correct


# 28. RESPONSIVE REQUIREMENTS

Test widths:

320px
375px
768px
desktop

No page-level horizontal scrolling.

Full:
three columns on wide screens; focus above two task columns at narrow widths.
Sparse plans use only the columns needed.

Compact:
one current-status row plus a queue or history count button.

At very narrow width, reduce internal padding before reducing readable text.

Never introduce a horizontal scroller to solve normal layout.


# 29. ACCESSIBILITY

- native buttons for interactive cards
- visible keyboard focus
- aria-label with full task title
- selected drawer card uses aria-pressed or equivalent
- color is not the sole state indicator
- ✓ / ● / ○ / ⚠ plus text labels remain
- reduced-motion support
- readable contrast
- timers use tabular numerals


# 30. V0.1 ACCEPTANCE CRITERIA

v0.1 is accepted when:

A. A local ToDoJo plugin can be installed.
B. A model can create a plan.
C. A single inline widget renders.
D. The model progresses through tasks while the widget updates.
E. Task IDs remain stable.
F. Timers remain correct after reload/restart.
G. Full view shows the focus and up to two other tasks in three columns.
H. Compact view shows one status row and a count control.
I. Queue and history drawers work as toggles.
J. Current dot animates subtly.
K. Block/resume produces correct timings.
L. No visible value is inferred or fabricated.
M. Negative activation tests pass consistently.


# 31. AFTER V0.1

Only after local behavior is reliable:

v0.2
- production storage adapter
- authentication/user isolation
- remote MCP deployment
- privacy policy
- hosted UI assets
- telemetry/error monitoring
- cross-device testing

v0.3
- marketplace listing assets
- screenshots
- description/starter prompts
- submission evaluation set
- security review
- public HTTPS endpoint
- public review/submission


# 32. IMPORTANT IMPLEMENTATION PRINCIPLE

The model decides the semantic meaning of work.

The MCP server records authoritative state.

The UI renders that state.

Never make the UI guess what the model is doing.


# DELIVERABLE

Implement ToDoJo v0.1 against this packet.

Before writing significant code:

1. Inspect the current OpenAI plugin/MCP Apps documentation.
2. Produce an implementation plan.
3. Identify any divergence between this packet and the current APIs.
4. Prefer current OpenAI/MCP Apps APIs over stale assumptions in this packet.
5. Then implement.
6. Run the full test suite.
7. Install through a local marketplace.
8. Perform clean-chat activation/evaluation testing.
9. Report exact failures or limitations rather than masking them.
