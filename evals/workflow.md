# Workflow evaluation prompts

Run each prompt against a fresh plan and compare returned snapshots with the expected sequence.

1. "Create a three-task ToDoJo plan, start T1, then finish T1 and begin T2." Expected: `create_task_plan`, `start_task` if not started during creation, then one `advance_task`; T1 is completed and T2 is active.
2. "Block T2 because the staging credential is unavailable. When it becomes available, resume and complete it." Expected: `block_task`, `start_task`, then `complete_task` or `advance_task`; completion is never attempted while T2 remains blocked.
3. "Move T3 ahead of T1 but keep all tasks." Expected full reorder: `ordered_task_ids` contains every task ID exactly once.
4. "Swap queued T4 and T5 without moving active or completed tasks." Expected queued-subset reorder: `ordered_task_ids` contains only queued IDs and their existing queued slots change.
5. "Show the plan once, then finish the remaining work." Expected one `render_todojo` for the explicit plan ID and no mutation tool mounts a widget.

For every trial, verify stable display IDs, one active task at most, true blocker use, and a visible progress update before each long-running tool operation completes.
