# ToDoJo v0.1 local acceptance record

Baseline: Phase 4 checkpoint `656588f`; this record covers Phase 5 hardening, global activation, and the subsequent layout candidate. Local-test package: `dist/todojo`. Status is **incomplete** until all required live acceptance criteria pass. Automated evidence, Codex sessions, and ChatGPT desktop observations are separate.

| ID | Requirement | Automated | Codex live | ChatGPT live | Evidence or exact limit |
| --- | --- | --- | --- | --- | --- |
| A | Local plugin install | pass | pass | untested | Normal Codex cache matches the built package; the plugin is enabled in the user profile and visible outside this checkout. ChatGPT desktop install has not been observed. |
| B | Model creates plan | pass | pass | untested | Fresh Codex session created a persisted three-task plan through the installed plugin; ChatGPT connection unavailable. |
| C | One inline widget | pass | untested | untested | Headless MCP Apps render tests passed; Codex inline MCP Apps disabled; ChatGPT connection unavailable. |
| D | Model progresses while widget updates | pass | untested | untested | Server transitions and headless widget integration passed separately; combined live desktop path pending. |
| E | Stable task IDs | pass | pass | untested | Codex model used T1/T2; isolated and normal installed clients read the same plan ID and permanent T numbers. ChatGPT connection unavailable. |
| F | Timers survive reload/restart | pass | untested | untested | SQLite and headless remount tests passed; live desktop reload pending. |
| G | Full three-column detail view | pass | untested | untested | Playwright responsive visual/geometry tests passed; desktop inline render pending. |
| H | Compact single-row summary | pass | untested | untested | Playwright compact layout tests passed; desktop inline render pending. |
| I | DONE/NEXT drawer toggles | pass | untested | untested | Playwright interaction tests passed; desktop inline render pending. |
| J | Current dot animation | pass | untested | untested | Playwright motion and reduced-motion tests passed; desktop inline render pending. |
| K | Block/resume timing | pass | pass | untested | Live Codex model blocked and resumed T1. A later read-only `get_task_plan` through the normal installed plugin returned final WORK 51,187 ms, matching the saved interval sum and excluding a 4,575 ms blocked gap (`verifications/2026-09-24-phase5-final-readback.json`). ChatGPT connection unavailable. |
| L | No fabricated visible values | pass | untested | untested | Widget snapshot binding tests passed; live model/widget observation pending. |
| M | Negative activation consistency | untested | pass | untested | Five exact Codex negative prompts made no ToDoJo tool calls (5/5); ChatGPT connection unavailable. |

## Activation trials

Five fresh chats are required for each positive category, with at least 4/5 passes, and five negative chats with 5/5 avoiding activation. A category remains untested until its required attempts are complete.

| Category | Codex attempts | Codex status | ChatGPT attempts | ChatGPT status | Exact limit |
| --- | --- | --- | --- | --- | --- |
| Explicit plan | 5/5 | pass | 0/5 | untested | All five fresh Codex trials met the recorded tool-sequence gate; ChatGPT connection unavailable. |
| Multi-file implementation | 5/5 | pass | 0/5 | untested | All five fresh Codex trials met the recorded tool-sequence gate; ChatGPT connection unavailable. |
| Debug investigation | 5/5 | pass | 0/5 | untested | All five fresh Codex trials met the recorded tool-sequence gate; ChatGPT connection unavailable. |
| Research and delivery | 5/5 | pass | 0/5 | untested | All five fresh Codex trials met the recorded tool-sequence gate; ChatGPT connection unavailable. |
| Resume existing plan | 5/5 | pass | 0/5 | untested | All five fresh Codex trials met the recorded tool-sequence gate; ChatGPT connection unavailable. |
| Negative activation | 5/5 | pass | 0/5 | untested | All five exact negative prompts made zero ToDoJo tool calls; ChatGPT connection unavailable. |

## Clean-chat activation evidence

Thirty fresh project-scoped Codex sessions used the installed ToDoJo plugin with a session-only override to the ignored `.test-profile/eval.sqlite`. Each positive creation trial called `create_task_plan` then `render_todojo` exactly once; each resume trial read its named blocked fixture, called `start_task` before `complete_task`, and rendered once. All five exact negative prompts made zero ToDoJo calls. Five of the positive prompts were indirect and did not name ToDoJo. Per-trial JSONL, model responses, errors, and summaries are under ignored `.test-profile/eval-runs/`. These trials measure activation and transition choice; their hypothetical code changes were intentionally not executed.

## Observed Codex workflow

A fresh project-scoped Codex session called `create_task_plan → start_task → block_task → start_task → advance_task → render_todojo` in that order. The session receipt is in ignored `verifications/2026-09-24-phase5-codex-model.jsonl`. An isolated installed client read the same plan, completed the test tasks, and the normal installed client read back all three as completed. The three package trees each have SHA-256 `44a4c08f3b77da3b89ad1a8619f737a159deb87421b8e6007d262993bdde0f4f` under the Phase 4 path/content hash algorithm. That receipt predates global enablement. The current normal user profile enables ToDoJo outside this checkout; the global trial below verifies it.

## Global normal-profile trial

The normal Codex user profile enables `todojo@todojo-local`; `codex plugin list` and `codex mcp list` from `/private/tmp` show the installed plugin and MCP server. The package-owned normal cache matches `dist/todojo`. A fresh substantial four-stage audit prompt from `/private/tmp` did not name ToDoJo, plan, or tracking. Its completed trace at ignored `.test-profile/global-implicit-write-allowed.jsonl` called `create_task_plan → start_task → render_todojo → advance_task → advance_task → advance_task → complete_task`, with exactly one render. The created evaluation plan ID was `e9713c3b-ed2e-4683-8a07-0f2f38fad9ef`, and all four tasks finished. A fresh one-sentence arithmetic prompt at `.test-profile/global-negative.jsonl` called no ToDoJo tool. The initial audit prompts banned all file changes; the agent cited that read-only constraint and skipped persisted status writes. They do not count as implicit-activation passes. The corrected prompt protected repository source files while permitting normal status writes. This proves implicit selection in fresh Codex CLI sessions; ChatGPT Work remains unobserved.

The isolated local-verification profile initially had the older skill bytes after the normal profile refresh. Refreshing that isolated cache fixed the exact `skills/todojo/SKILL.md` parity failure; `npm run verify:local` then passed its installed parity, launcher, cross-process database, and A–M record checks. The Switchyard Task 5.3 route produced the intended one-line skill edit but failed its check because `/usr/bin/python3` lacked PyYAML; the same staged edit passed the validator with `/opt/homebrew/bin/python3` and was integrated unchanged.

## Desktop access boundary

The browser-control bridge failed twice at initialization with `failed to start Node runtime: No such file or directory` during this task; no independent local bridge log was retained, so this failure is a task observation rather than a reproducible receipt. No automated ChatGPT desktop UI observation was possible in this run. Current OpenAI connection guidance requires a developer-mode registered MCP server reachable through HTTPS or Secure MCP Tunnel for ChatGPT MCP tool and inline widget trials. No developer-mode connection, app ID, tunnel, or runtime key has been supplied. These rows are untested, not passes or product failures.

## Private connection preflight

The package includes `bin/todojo-tunnel-child`. A synthetic-credential test showed its MCP child received only `TODOJO_DB_PATH`; macOS also injected process metadata. The official `tunnel-client` binary is now installed locally through Homebrew; no tunnel profile, owner-registered app ID, runtime key, or fixed BWS consumer is available. No network tunnel was started. The registered `.app.json` binding gate is implemented but intentionally cannot pass before the owner supplies an actual ID. No ChatGPT tool or widget result is inferred from these preflight tests.

## Release-hardening candidate verification

The initial Phase 5 Standard review and its targeted remediation review apply to the earlier local-record candidate. The release-hardening holistic review found two Medium issues in the optional registered-app build path; the current candidate validates that binding during build and package verification and tests the real isolated build. The targeted review outcome is kept with the local candidate report. The original four audit leads were reproduced and fixed: blocked-current migration backfill, full reorder after a plan grows past 100 tasks, failed initial widget connection, and installed parity accepting extra files. Versioned SQLite backup and two-process startup contention fixes were added to satisfy the approved plan and startup progress invariant.

On the release-hardening candidate, `npm run test` passed 47 source tests with two installed-only skips and all 14 headless Playwright cases. `npm run quality` passed typecheck, Biome, and Knip after formatting the package verifier and its test. The exact two-process startup selector passed 30 consecutive runs after the WAL fix and 10 more after startup status was centralized. The source manifest gate passed. Both normal and isolated Codex plugin caches were refreshed from the rebuilt nine-file package; `npm run verify:package -- --installed-path ~/.codex/plugins/cache/todojo-local/todojo/0.1.0` and `npm run verify:local` passed. The latter exercised the installed launcher, cross-process database behavior, and this A–M record.

## Full and Compact layout candidate

The revised Full view uses three columns for task detail, queue, and history; Compact uses one summary row. At 760 px, headless browser captures measured 166 px for Full and 67 px for Compact. The combined candidate passed 49 source tests with two installed-only skips and 17 Playwright tests; quality, normal installed-byte parity, and isolated `verify:local` passed. The layout review's two Medium findings were fixed and its targeted follow-up found none remaining. These are automated and installed-plugin checks; live ChatGPT widget acceptance remains untested.

The local-test ZIP contains the nine package files, including both theme icons, with no macOS metadata entries. Its SHA-256 is `601c4d4452d1fb75ef37f15b82b2734d17d376fb9dc67a88067a89ceba8a1d69`. It embeds this host's database path and is not a public marketplace upload. The candidate-specific HTML report and independent review bind release decisions; this automated record alone does not approve publication. ChatGPT desktop A–M paths and clean-chat activation remain untested; automated, Codex, and ChatGPT columns above retain their separate meanings.
