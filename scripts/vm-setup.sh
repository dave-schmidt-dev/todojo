#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

printf 'ToDoJo VM setup: checking guest Node and npm paths.\n' >&2
command -v node
node --version
command -v npm
npm --version
node scripts/verify-vm-preflight.mjs --versions-only

printf 'ToDoJo VM setup: installing the locked npm workspace.\n' >&2
npm ci --no-audit --no-fund --progress=false

printf 'ToDoJo VM setup: verifying the pinned SDK and native build stack.\n' >&2
npm run verify:stack

printf 'ToDoJo VM setup: installing the pinned headless Chromium build.\n' >&2
./node_modules/.bin/playwright install chromium --only-shell

printf 'ToDoJo VM setup: running the host-compatible browser probe.\n' >&2
npm run verify:vm-preflight
