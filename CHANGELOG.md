# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Development suspended pending verified host PiP or an equivalent persistent in-host display; the local installation was removed.
- Server instructions, tool descriptions, the ToDoJo skill, README, and the specification now direct the model to call read-only `render_todojo` once with the explicit plan ID as the last tool call before each user-facing turn-ending response, including a blocked handoff and completion, so the latest snapshot appears near the bottom of the conversation.

### Added

- Experimental PiP diagnostics make one automatic request per connected server session, report the actual host result, and record bounded private telemetry. Manual retry remains available when the session claim fails.
- Transport regression coverage: repeated read-only `render_todojo` calls return the latest plan state without changing the persisted version, status, or task IDs.

### Fixed

- Agent workflow reliability: removed the stale never-render-again-after-creation ban that stranded the widget above subsequent conversation messages. Creation still renders with no immediate duplicate, renders are not repeated after every transition, poll, or commentary, and the docs no longer claim earlier cards can be moved or deleted or that permanent bottom placement or host pinning is guaranteed.

## [0.2.1] - 2026-09-28

### Removed

- The unsupported Keep visible control and its host placement plumbing.

## [0.2.0] - 2026-09-28

### Added

- A Keep visible control that requests host PiP and reports the actual host mode, limits, and errors.

### Changed

- `create_task_plan` creates, starts, and displays the first task widget in one call; `start_first: false` preserves a queued plan.

### Fixed

- Serialized source test files that share package build output.
- Derived package verification from the authoritative root version.
