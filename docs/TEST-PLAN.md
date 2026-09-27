# Plugin package test plan

## Task 4.1: source and artifact

1. Run `npm run verify:package -- --manifest-only`. It validates the portable root schemas, the relative stdio command/cwd, absence of source DB paths and credentials, and the marketplace entry at `./dist/todojo` with installation, authentication, and category policy fields.
2. Run `npm run test:server`. It covers source/package structure and the ToDoJo skill rules for plan binding, blocked-task resume, full and queued-subset reorder, true blockers, one render, and visible progress.
3. Run `npm run build` with an absolute `TODOJO_DB_PATH` (or let the build choose the repository's ignored `.data/todojo.sqlite`). It stages ignored `dist/todojo`, copies the self-contained MCP bundle, launcher, skills, and available assets, and injects only `TODOJO_DB_PATH` into its generated `mcp.json`.

## Task 4.2: host-only artifact and installation

1. Supply the separate light and dark icon variants, preserve `assets/source/todojo-light-dark.png`, rebuild, and confirm the artifact includes all three assets.
2. Run `npm run verify:package` to validate artifact portability and content. Then use `--installed-path <installed-plugin-root>` to compare each package-owned file with the installed bytes and disclose any host-generated `.codex-plugin` overlay.
3. In an isolated profile, install from the repository marketplace. Confirm the installed MCP launcher resolves `./bin/todojo-mcp`, observes the generated absolute DB path, and does not depend on the source checkout. Run `TODOJO_INSTALLED_ROOT=<installed-plugin-root> npm run test:server` to call a read-only tool through those installed bytes.
4. Use an authenticated ephemeral Codex session with a one-session MCP override pointing to that installed root; record the actual MCP tool event. This exercises the installed server through Codex without enabling the plugin in unrelated sessions. Record that the override verifies runtime behavior while the isolated profile verifies plugin ingestion.

## Widget layout acceptance

At a 760 px widget width, Full must present the current task with history and queued work in distinct columns and show stored descriptions or blocked reasons when present. Compact must fit its task summary and counts in one row, remain materially shorter than Full, and preserve the timer and task details. Switch modes with a drawer open and verify that the drawer closes without losing plan state. Capture both rendered modes through the Playwright UI suite.

## Model evaluation

Run [positive activation](../evals/activation.md): each of the five categories must pass at least 4/5 clean trials. Run [negative activation](../evals/negative.md): all 5/5 trials must avoid ToDoJo activation. Run [workflow](../evals/workflow.md) prompts and retain the tool/snapshot evidence.

## Task 5.1: local installed acceptance

1. Rebuild `dist/todojo`, reinstall through the local marketplace in the isolated and normal Codex profiles, and use `npm run verify:package -- --installed-path <root>` for each exact installed tree. Enable ToDoJo in the normal user profile, remove the temporary project-only override, and verify discovery from a fresh session outside this repository. An indirect substantial request must activate ToDoJo without naming it; simple factual requests must not.
2. Run `npm run verify:local` for installed tool discovery, cross-process database readback, restart persistence, all eleven tool contracts, and the A–M record. Inspect `evals/results.md`; automated, Codex live, and ChatGPT live columns are separate.
3. Run five fresh Codex chats for each positive activation category and five negative chats. Preserve the per-trial receipts under ignored `.test-profile/eval-runs/`; apply the 4/5 positive and 5/5 negative thresholds. A tool or widget path without a live ChatGPT connection stays `untested`.

## Task 5.2: private ChatGPT connection, when developer access is available

This is a developer-only acceptance route for v0.1, not a marketplace installer flow. ToDoJo users are never asked for a tunnel key or BWS setup. The owner supplies developer-mode/workspace eligibility, tunnel identity and permission, a runtime key through BWS, and a fixed `bws-secret-exec` consumer. The fixed tunnel command must point its stdio MCP child at packaged `bin/todojo-tunnel-child`; the wrapper passes only the package's absolute `TODOJO_DB_PATH` to the MCP bundle. `tests/tunnel-env.test.ts` verifies key isolation with synthetic values. Do not log or pass a runtime key as an argument.

After the owner registers the MCP connection, put the real registered ID in root `.app.json` as `apps.todojo.id`; set root `plugin.json` `extensions.com.openai.apps` to `./.app.json`. Rebuild, reinstall, and run `npm run verify:local -- --tunnel-preflight` to check the source/package/installed binding. Then exercise each remaining ChatGPT A–M criterion and activation category in fresh desktop sessions and record observed results. A missing app ID makes the tunnel preflight fail explicitly. The local ZIP is a host-specific test artifact, not a public marketplace submission. A future public MCP plugin needs a separately designed production connection; do not convert this development tunnel into an installer requirement.

## SQLite upgrade and startup verification

`npm run test:core` exercises fresh v1 creation, legacy active/blocked pointer backfill, a unique validated pre-v1 backup, rollback and fresh-snapshot retry after a source change, future-version rejection without database mutation, and two-process startup contention. Startup emits pending and result/error on stderr around lock-prone work; MCP stdout remains protocol-only. Installed acceptance uses the configured project `.data/todojo.sqlite`, while fixture tests use disposable databases. A backup stays next to its source database and is never part of the plugin ZIP.
