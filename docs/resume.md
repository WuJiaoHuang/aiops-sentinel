# Resume Notes

## Project Entry

**AIOps Sentinel: Java + AI Agent AIOps incident diagnosis platform**

- Evolved a full-stack AIOps platform into a Spring Boot business gateway plus AI Agent Runtime, covering incident monitoring, service metrics, log search, async diagnosis tasks, audit traces, and root cause analysis.
- Added a Java 17 Spring Boot API module with REST controllers, validation, MySQL/JPA entities and repositories, Redis TTL task cache, Actuator endpoints, integration tests, and an AI service proxy for backend-focused interviews.
- Built a real MCP Server with the official TypeScript SDK and stdio transport, exposing incident summary, metric query, log search, dependency tracing, Runbook knowledge search, and rollback advice as MCP tools.
- Implemented a plan-driven Agent workflow that connects through an MCP Client, calls `listTools` / `callTool`, collects operational evidence, calls DeepSeek with a structured prompt, and falls back to deterministic mock diagnosis for stable demos.
- Developed a local CLI for service scanning, incident diagnosis, log lookup, and report generation, connecting frontend, backend, and AI tooling into one engineering workflow.
- Maintained AI Coding assets including Rules, Skills, and prompt templates to support requirement decomposition, code review, and incident postmortem generation.

## Interview Talking Points

- Why the project uses Spring Boot as the business gateway and keeps AI reasoning in a separate runtime.
- How MySQL stores incidents/tasks/audit data while Redis caches running task state with TTL and gracefully falls back to MySQL.
- Why AIOps is suitable for Agent workflows.
- How the MCP Server is separated from Agent planning, and how the Agent invokes tools through MCP instead of direct function calls.
- How RAG-style Runbook retrieval improves diagnosis reliability.
- Why the DeepSeek integration uses mock fallback.
- How the same core package supports web, API, and CLI.
- What should be added next: Java entity/repository persistence, Kafka task queue, streaming steps, real Prometheus/Elasticsearch ingestion, and deployment.

## Chinese Resume Version

**AIOps Sentinel 智能运维故障诊断平台**

- 基于 React、TypeScript、Spring Boot、MySQL、Redis 和 DeepSeek 构建智能运维故障诊断平台，覆盖告警看板、服务指标、日志检索、异步诊断任务、审计记录和根因分析。
- 新增 Java 17 Spring Boot 网关模块，提供 REST 接口、参数校验、MySQL/JPA 实体与 Repository、Redis TTL 任务缓存、Actuator 可观测端点、集成测试和 AI 服务代理，强化 Java 后端岗位匹配度。
- 基于官方 MCP TypeScript SDK 实现真实 MCP Server，通过 stdio transport 暴露故障摘要、指标查询、日志检索、依赖追踪、Runbook 知识检索和回滚建议工具，实现工具能力与 Agent 编排解耦。
- 实现计划驱动的 Agent 诊断流程，通过 MCP Client 执行 `listTools` / `callTool`，根据故障上下文选择工具，沉淀证据链、置信度、影响范围和处置建议，并支持 DeepSeek 调用失败后的本地兜底结果。
