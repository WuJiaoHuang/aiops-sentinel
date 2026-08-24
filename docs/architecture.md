# Architecture

## Runtime Flow

1. The user opens the React incident console and selects an incident.
2. The UI requests or locally runs a diagnosis for the selected incident.
3. The Agent loads incident context and invokes MCP-style tools.
4. Tools collect logs, metrics, dependency information, and rollback signals.
5. The DeepSeek adapter creates a diagnosis when an API key exists.
6. If DeepSeek is unavailable, the adapter returns a deterministic mock diagnosis.
7. The UI and CLI render the same diagnosis model.

## MCP-Style Tool Contract

Every tool follows the same structure:

```ts
type ToolResult<T> = {
  result: T;
  metadata: {
    tool: string;
    durationMs: number;
    mock: boolean;
  };
};
```

This keeps tools reusable across frontend demos, API endpoints, CLI commands, and Agent workflows.

## Agent Workflow

The diagnosis Agent is intentionally deterministic in the first version:

- Load incident summary.
- Search related service logs.
- Query the latest metric window.
- Trace service dependencies.
- Ask rollback advisor for release-risk guidance.
- Send the evidence chain to DeepSeek or mock fallback.

The next stage should persist diagnosis tasks and stream Agent steps to the UI.
