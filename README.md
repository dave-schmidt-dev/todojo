# ToDoJo

Live, numbered to-do tracking for substantial ChatGPT and Codex work.

**Status:** v0.1 implementation in progress.

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
| `assets/source/todojo-light-dark.png` | Owner-provided light and dark icon source for the upload package. |

## Planning artifacts

The [v0.1 specification](docs/SPEC.md) adapts the original build and test packet to the ToDoJo name. The implementation plan, phase task contract, and review closeout are maintained in the local planning archive. The plugin and package identifier is `todojo`.

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
```

The Phase 0 gate also runs `npm run verify:vm-preflight` against a disposable macOS guest. Git hooks keep precommit checks fast; the prepush hook runs the broader gate. Build output, runtime data, logs, the test profile, and operational `HISTORY.md`/`TASKS.md` stay local and ignored.

## Delivery

The reviewed local plan and task contract define phase gates. Complete each gate before the next phase. The host checkpoints accepted phases locally and pushes the implementation to the public repository after complete acceptance. Local installation remains the v0.1 target.

## Conventions

- All files self-contained under this directory.
- Secrets in BWS. Never committed.
- Update `HISTORY.md` alongside every meaningful change. Bug entries cite the files touched (`- files: path/a.py, path/b.ts`).
- Tests verify real behavior — no smoke-only "did it run" checks.
