# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-28

### Added

- A Keep visible control that requests host PiP and reports the actual host mode, limits, and errors.

### Changed

- `create_task_plan` creates, starts, and displays the first task widget in one call; `start_first: false` preserves a queued plan.

### Fixed

- Serialized source test files that share package build output.
- Derived package verification from the authoritative root version.
