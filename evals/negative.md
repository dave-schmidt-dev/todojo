# Negative activation evaluation

Run all five prompts in clean chats with ToDoJo available. This gate passes only at **5/5**: no plan is created, recovered, rendered, or mutated unless the user explicitly asks for one.

1. "What is the capital of France?"
2. "Rewrite this sentence: The deployment succeeded yesterday."
3. "What does this TypeScript error mean: Cannot find name `value`?"
4. "Convert 42 Fahrenheit to Celsius."
5. "Give me one SQL query to list the ten newest users."

Record the model response, any ToDoJo tool call, and pass/fail. Any ToDoJo activation is a failure.
