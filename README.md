# ToDoJo

Live, numbered to-do tracking for substantial ChatGPT and Codex work.

**Status:** v0.2.1 local candidate. ChatGPT desktop inline-widget acceptance remains pending.

## Priorities (in order)

1. Authoritative task state and stable task IDs.
2. Accurate persisted work timers and atomic transitions.
3. Accessible Full and Compact views that display only stored state.
4. Reliable local installation and behavior tests.

## Layout

| Path | Purpose |
|---|---|
| `README.md` | This file. |
| `HISTORY.md` | Meaningful changes, bugs, remediation, regression notes. |
| `TASKS.md` | Per-project task tracking. |
| `INVARIANTS.md` | Behavioral contract and verification gates. |
| `docs/SPEC.md` | ToDoJo v0.1 specification, adapted from the user-provided build and test packet. |
| `LICENSE` | MIT. |
| `assets/source/todojo-light-dark.png` | Owner-provided light and dark icon source, preserved without modification. |
| `assets/icons/todojo-light.png` / `todojo-dark.png` | Separate light and dark theme icon variants included in the local package. |
| `server/src/` | Typed plan model, SQLite repository, timers, MCP tools, and progress callbacks. |
| `bin/todojo-mcp` | Executable stdio MCP launcher for a bundled install. |
| `bin/todojo-tunnel-child` | MCP child launcher for a future private tunnel connection; forwards only the configured database path. |
| `web/src/` | Inline Full and Compact widget, MCP Apps bridge, and styles. |
| `scripts/verify-launcher.mjs` | Installed-entry test outside the source checkout. |
| `plugin.json` / `mcp.json` | Portable Agent Plugins source manifests. |
| `skills/todojo/SKILL.md` | Model workflow for keeping a plan accurate. |
| `.agents/plugins/marketplace.json` | Repository marketplace source for the ignored package. |
| `scripts/verify-package.mjs` | Source, artifact, and installed-byte package verification. |
| `scripts/verify-local.mjs` | Installed local acceptance and registered-app preflight. |
| `evals/results.md` | Candidate-specific A–M and clean-chat evidence, including untested desktop paths. |

## Planning artifacts

The [v0.1 specification](docs/SPEC.md) adapts the original build and test packet to the ToDoJo name. The implementation plan, phase task contract, and review closeout are maintained in the local planning archive. The plugin and package identifier is `todojo`. The root `package.json` is the authoritative version; workspace manifests, `plugin.json`, and `package-lock.json` must match it. ToDoJo uses `0.y.z` SemVer while its public API is evolving: features or breaking changes increment `y`, and compatible fixes increment `z`. See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Workflows

- Plan: check current OpenAI plugin and MCP Apps documentation against the v0.1 packet before implementation.
- Implement: build the local plugin in phases, verifying state, timers, UI, and model behavior.
- Accept: install from a local marketplace and run clean-chat activation tests.

## Development

Use Node 26.7 or newer and npm 11 or newer with the locked dependencies in `package.json`, then run:

```sh
npm ci
npm run verify:stack
npm run quality
npm run test:core
npm run test:server
npm run test:ui
npm run verify:launcher
npm run verify:package -- --manifest-only
```

The SQLite repository opens in WAL mode and stores all task transitions atomically. Before upgrading an existing unversioned database, startup creates a unique, integrity-checked pre-v1 backup beside that database, then updates schema and version in one transaction. A failed upgrade preserves its validated backup; retry takes a fresh snapshot. New databases need no backup, and future schema versions are rejected. Installed and tunnel launches must supply an absolute `TODOJO_DB_PATH`; explicit `TODOJO_DEV_MODE=1` uses this repository's ignored `.data/todojo.sqlite` during development. Snapshots include a server timestamp, total active work time, and the current task ID even when that task is blocked. `npm run test:ui` builds the self-contained widget and runs the headless Playwright suite. The MCP server runs over stdio; `bin/todojo-mcp` starts the bundled server and forwards its arguments. It does not open an HTTP listener. Installed runs require an absolute `TODOJO_DB_PATH`. Logs default beside the configured database (in project `.logs/` when the database is in project `.data/`); `TODOJO_LOG_PATH` can explicitly set another absolute path. Status events go to the MCP logging channel and stderr, while the rotating file records warnings and errors by default or debug details with `--debug`.

For new work, call `create_task_plan` once: it starts T1 by default and renders the widget. Set `start_first=false` to leave work queued. Keep its explicit plan ID; mutations update the existing widget. Use read-only `render_todojo` once with an explicit plan ID for resume or recovery.

Full uses the available width for the current task, recent history, and queued work, including descriptions and blocked reasons. Compact is a single-row summary with the current task, timer, and queue/history counts; switching views preserves the same persisted plan state.

The Phase 0 gate also runs `npm run verify:vm-preflight` against a disposable macOS guest. Git hooks keep precommit checks fast; the prepush hook runs the broader gate. Build output, runtime data, logs, the test profile, and operational `HISTORY.md`/`TASKS.md` stay local and ignored.

`npm run build` stages a portable ignored package in `dist/todojo`. The source manifests contain no host path or database setting; the generated package adds exactly one absolute `TODOJO_DB_PATH` to its `mcp.json`, uses the bundled `./bin/todojo-mcp`, and copies skills plus available assets. The package includes the preserved owner source art and separate light/dark icon variants. Run `npm run verify:package -- --manifest-only` before host packaging; pass `--installed-path` after installation to compare package-owned bytes. `dist/todojo-0.2.1-local.zip` is a local-test ZIP with this machine's absolute database path in its generated `mcp.json`; do not submit it as a public marketplace package. The light and dark icons are included for later distribution. When refreshing the local ZIP on macOS, suppress resource forks and extended attributes (for example `DITTONORSRC=1 ditto -c -k --norsrc --keepParent dist/todojo dist/todojo-0.2.1-local.zip`) and verify its regular-file list matches `dist/todojo`. Public submission is outside the local candidate and needs its own deployment design.

The installed local plugin is enabled in the normal user profile so it is available across local Codex sessions; substantial multi-step work should select its skill without the user naming ToDoJo. Run `npm run verify:local` to compare isolated installed bytes, exercise the installed MCP across processes and restarts, and check the A–M record. ChatGPT tool and inline-widget acceptance requires a developer-mode registered connection. For developer-only ChatGPT testing, the optional private-tunnel child reads the built `mcp.json` and launches the MCP bundle with only `TODOJO_DB_PATH`; it does not inherit the developer tunnel runtime key. ToDoJo local installs and marketplace users do not need a ToDoJo API key or BWS setup. Once the owner supplies a real registered app ID, place it in `.app.json`, reference `./.app.json` under `extensions.com.openai.apps`, rebuild and reinstall, then run `npm run verify:local -- --tunnel-preflight`. No app ID or runtime key is committed or fabricated.

## Delivery

The reviewed local plan and task contract define phase gates. Complete each gate before the next phase. The host checkpoints accepted phases locally and pushes the implementation to the public repository after complete acceptance. Local installation remains the v0.1 target.

## Conventions

- All files self-contained under this directory.
- Developer-only test credentials, if used, follow the host's BWS policy and are never committed or included in an install package.
- Update `HISTORY.md` alongside every meaningful change. Bug entries cite the files touched (`- files: path/a.py, path/b.ts`).
- Tests verify real behavior — no smoke-only "did it run" checks.
