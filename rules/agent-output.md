# Agent Output Rules

The incident diagnosis Agent must return:

- `incidentId`
- `rootCause`
- `confidence`
- `impact`
- `recommendation`
- `rollbackAdvice`
- `evidence`

The Agent should cite evidence from tool outputs and avoid unsupported conclusions.
