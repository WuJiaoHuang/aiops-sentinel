# Resume Notes

## Project Entry

**AIOps Sentinel: LLM Agent + MCP 智能故障诊断平台**

- 将 AIOps Sentinel 改造成基于 LLM Agent + MCP 的智能故障诊断平台，覆盖告警接入、服务指标、日志检索、依赖追踪、异步诊断任务、审计记录、Agent Trace 和根因分析。
- 新增 Java 17 Spring Boot 网关模块，提供 REST 接口、参数校验、MySQL/JPA 实体与 Repository、Redis TTL 任务缓存、Actuator 可观测端点、集成测试和 AI 服务代理，用于体现后端工程能力。
- 基于官方 MCP TypeScript SDK 实现真实 MCP Server，通过 stdio transport 暴露故障摘要、指标查询、日志检索、依赖追踪、服务健康、Runbook 知识检索和回滚建议工具。
- 实现基于 AgentState 和 LLM 决策的动态 Tool Calling Agent，通过 MCP Client 执行 `listTools` / `callTool`，支持 `maxSteps`、重复 Tool Call 去重、Tool/LLM 超时、错误隔离、fallback 和不确定诊断。
- 通过 Agent Trace 记录 LLM 决策、Tool 输入输出、失败步骤、耗时、最终诊断和置信度，前端可按顺序查看完整诊断过程。
- 通过 ActionProposal 实现 Human-in-the-loop，高风险回滚、重启、配置修改只生成建议并标记需要人工确认，不自动执行线上修复。
- 整理 AI Coding 资产，包括 `AGENTS.md`、Rules、Skills 和 prompt templates，用规则与 Skill 约束 AI 开发流程。

## Interview Talking Points

- 为什么项目定位是 LLM Agent + MCP 智能故障诊断平台，而不是普通后台管理系统。
- AgentState 如何承载 messages、incident、evidence、toolCalls、hypothesis、confidence 和 finalDiagnosis。
- LLM 如何基于当前状态动态决定下一步 Tool，而不是按预设排查流水线执行。
- Agent 如何通过 MCP Client 调用真实 MCP Server，并用 `listTools` / `callTool` 获取工具能力和证据。
- Tool Contract 如何统一日志、指标、依赖、健康检查、知识库和回滚建议工具。
- `maxSteps`、重复调用去重、Tool/LLM 超时、错误隔离和 fallback 如何提升 Agent 稳定性。
- Agent Trace 如何让诊断过程可观测、可回放、可排查。
- Human-in-the-loop 如何避免自动执行高风险运维修复。
- Java 网关如何体现 Spring Boot、MySQL、Redis、Actuator 和异步任务等后端能力。

## Chinese Resume Version

**AIOps Sentinel 智能运维故障诊断平台**

- 基于 React、TypeScript、Spring Boot、MySQL、Redis 和 DeepSeek 构建智能运维故障诊断平台，覆盖告警看板、服务指标、日志检索、异步诊断任务、审计记录和根因分析。
- 新增 Java 17 Spring Boot 网关模块，提供 REST 接口、参数校验、MySQL/JPA 实体与 Repository、Redis TTL 任务缓存、Actuator 可观测端点、集成测试和 AI 服务代理，强化 Java 后端岗位匹配度。
- 基于官方 MCP TypeScript SDK 实现真实 MCP Server，通过 stdio transport 暴露故障摘要、指标查询、日志检索、依赖追踪、服务健康、Runbook 知识检索和回滚建议工具，实现工具能力与 Agent Runtime 解耦。
- 实现基于 AgentState 和 LLM 决策的动态 Tool Calling Agent，通过 MCP Client 执行 `listTools` / `callTool`，沉淀证据链、Agent Trace、置信度、影响范围、处置建议和高风险 ActionProposal，并支持 DeepSeek 调用失败后的稳定 fallback。
