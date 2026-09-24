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

## Model evaluation

Run [positive activation](../evals/activation.md): each of the five categories must pass at least 4/5 clean trials. Run [negative activation](../evals/negative.md): all 5/5 trials must avoid ToDoJo activation. Run [workflow](../evals/workflow.md) prompts and retain the tool/snapshot evidence.
