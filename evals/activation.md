# Positive activation evaluation

Run each category in five clean chats with ToDoJo available. A category passes at 4/5 or better when the model creates or recovers an explicit plan and follows the requested workflow without selecting an unrelated plan.

| Category | Prompt |
| --- | --- |
| Explicit plan | "Use ToDoJo to plan and carry out this five-step repository cleanup." |
| Multi-file implementation | "Add a settings page, server route, tests, and docs. Keep progress visible with ToDoJo." |
| Debug investigation | "Investigate this failing integration test, make the fix, and track the steps in ToDoJo." |
| Research and delivery | "Research the current API migration, implement the compatible change, and use ToDoJo for the work plan." |
| Resume existing plan | "Resume ToDoJo plan `<plan_id>` and finish its blocked database-migration task after the dependency is available." |

Record each trial as pass/fail/untested, the plan ID if one was used, tool sequence, and any unexpected activation.
