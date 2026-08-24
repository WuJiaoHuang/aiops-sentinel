# Resume Notes

## Project Entry

**AIOps Sentinel: AI-driven full-stack incident diagnosis platform**

- Built a full-stack AIOps platform with React, TypeScript, Node.js, and Express, covering incident monitoring, service metrics, log search, and AI-assisted root cause diagnosis.
- Designed an MCP-style tool layer that encapsulates log search, metric query, dependency tracing, incident summary, and rollback advice behind unified tool contracts.
- Implemented an Agent workflow that collects operational evidence, calls DeepSeek with a structured prompt, and falls back to deterministic mock diagnosis for stable demos.
- Developed a local CLI for service scanning, incident diagnosis, log lookup, and report generation, connecting frontend, backend, and AI tooling into one engineering workflow.
- Maintained AI Coding assets including Rules, Skills, and prompt templates to support requirement decomposition, code review, and incident postmortem generation.

## Interview Talking Points

- Why AIOps is suitable for Agent workflows.
- How tool contracts are separated from Agent reasoning.
- Why the DeepSeek integration uses mock fallback.
- How the same core package supports web, API, and CLI.
- What should be added next: task persistence, streaming steps, real metrics ingestion, and deployment.
