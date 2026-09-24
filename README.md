# ToDoJo

Live, numbered to-do tracking for substantial ChatGPT and Codex work.

**Status:** scaffolded; v0.1 implementation plan reviewed and ready for Phase 0.

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

## Planning artifacts

The [v0.1 specification](docs/SPEC.md) adapts the original build and test packet to the ToDoJo name. The implementation plan, phase task contract, and review closeout are maintained in the local planning archive. The plugin and package identifier is `todojo`.

## Workflows

- Plan: check current OpenAI plugin and MCP Apps documentation against the v0.1 packet before implementation.
- Implement: build the local plugin in phases, verifying state, timers, UI, and model behavior.
- Accept: install from a local marketplace and run clean-chat activation tests.

## Conventions

- All files self-contained under this directory.
- Secrets in BWS. Never committed.
- Update `HISTORY.md` alongside every meaningful change. Bug entries cite the files touched (`- files: path/a.py, path/b.ts`).
- Tests verify real behavior — no smoke-only "did it run" checks.
