# Invariants — ToDoJo

This is the local v0.1 contract. Each gate is implemented alongside the behavior it protects.

## Standing invariants

### INV-1 — Visible work reports progress
area: ["server/src/**/*.ts", "web/src/**/*.ts", "web/src/**/*.tsx"]
gate_test: tests/progress-visibility.test.ts
threshold: 3
rationale: Network calls, persistence, and browser updates can stall. The server and widget expose status while work is pending, without leaking data to stdout.

## Project-specific invariants

### INV-2 — IDs and current state are authoritative
area: ["server/src/**/*.ts"]
gate_test: tests/state-transitions.test.ts
threshold: 3
rationale: Task display IDs never change or repeat, one plan has at most one active task, and a blocked current task remains identifiable.

### INV-3 — Work time is persisted and excludes blocked time
area: ["server/src/**/*.ts"]
gate_test: tests/timers.test.ts
threshold: 3
rationale: Server-owned UTC intervals determine task and overall work duration across reloads and restarts.

### INV-4 — The UI displays only server state
area: ["web/src/**/*.ts", "web/src/**/*.tsx", "web/src/**/*.css"]
gate_test: tests/todojo-layout.spec.ts
threshold: 3
rationale: Task status, counts, titles, reasons, and time come from snapshots; local state controls only presentation.

### INV-5 — Every transition is atomic and durable
area: ["server/src/**/*.ts"]
gate_test: tests/persistence.test.ts
threshold: 3
rationale: Partial transitions, task-number reuse, and lost state after restart would make the plan untrustworthy.
