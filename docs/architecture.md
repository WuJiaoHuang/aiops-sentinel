# 架构说明

## 项目定位

AIOps Sentinel 是基于 LLM Agent + MCP 的智能故障诊断平台。主线不是传统后端 CRUD，而是：

```text
Incident
  -> Agent Runtime
  -> LLM 动态决策
  -> MCP Client
  -> MCP Server
  -> Logs / Metrics / Dependency / Knowledge / Service Health
  -> Evidence
  -> Agent Trace
  -> Final Diagnosis + ActionProposal
```

## Runtime Flow

1. 用户打开 React 控制台并选择一条 Incident。
2. 前端通过 Node.js API 创建异步诊断任务。
3. 后端调度 `packages/core/src/agent.ts` 中的 Agent Runtime。
4. Agent 初始化 AgentState，包含 messages、incident、evidence、toolCalls、currentHypothesis、confidence、stepCount、finalDiagnosis。
5. Agent 每轮调用 LLM 生成结构化决策：继续调用 Tool，或终止并输出最终诊断。
6. Agent 通过 MCP Client 连接 `packages/mcp-server`。
7. MCP Server 使用官方 MCP SDK 暴露日志、指标、依赖、知识库和服务健康工具。
8. ToolResult 写入 evidence、messages、toolCalls 和 Agent Trace。
9. Agent 检测重复 Tool Call，相同工具和相同参数会跳过并记录。
10. LLM 或 Tool 失败时记录 ERROR Step，并进入 retry、fallback 或不确定诊断。
11. 诊断完成后，API 持久化任务，前端展示诊断结论、证据链、Agent Trace 和 ActionProposal。

## MCP 工具层

MCP Server 对外工具名：

```text
incident_summary
query_logs
query_metrics
query_dependency
get_service_health
search_knowledge
rollback_advisor
```

内部 Tool Registry 工具名：

```text
incident_summary
log_search
metric_query
dependency_trace
service_health
knowledge_search
rollback_advisor
```

映射关系在 `packages/core/src/tools.ts` 的 `mcpName` 字段中声明，由 `packages/core/src/mcpClient.ts` 负责调用。

## Tool Contract

所有 Tool 必须遵循：

```ts
type ToolDefinition = {
  name: ToolName;
  mcpName: McpToolName;
  description: string;
  inputSchema: JsonSchema;
  execute: (input, context) => Promise<ToolResult> | ToolResult;
};
```

标准结果：

```ts
type ToolResult<T> = {
  success: boolean;
  data: T | null;
  error: string | null;
  source: "mock" | "mcp" | "api";
  latencyMs: number;
  timestamp: string;
};
```

Tool 失败不能抛出未捕获异常，应返回 `success=false` 并写明 `error`。

## 动态 Tool Calling Agent

Agent 不再写死任何固定三段式诊断顺序。它每轮基于当前状态决策：

```text
AgentState
  -> LLM Decision
  -> Tool Call 或 Final
  -> MCP ToolResult
  -> 更新 Evidence / Messages / Trace
  -> 下一轮 LLM Decision
```

关键机制：

- `maxSteps` 默认 8。
- 相同 Tool + 相同参数去重。
- Tool timeout 和错误隔离。
- LLM timeout、retry、exponential backoff、fallback。
- 达到最大步数或证据充分时终止。
- 证据不足时输出“不确定”。

## Agent Trace

每次诊断生成 AgentRun：

```text
runId
incidentId
model
status
startTime
endTime
totalLatency
totalToolCalls
finalDiagnosis
confidence
steps
```

每个 AgentStep：

```text
stepIndex
type: LLM / TOOL / ERROR / FINAL
toolName
toolInput
toolOutput
latency
timestamp
summary
```

前端“诊断过程”区域直接展示 AgentStep，让面试官能看到 Agent 为什么调用某个工具、工具返回了什么、失败如何处理。

## Human-in-the-loop

`rollback_advisor` 只输出 ActionProposal，不执行回滚。

```ts
type ActionProposal = {
  action: string;
  reason: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  evidence: string[];
  requiresApproval: boolean;
};
```

`MEDIUM` 和 `HIGH` 必须显示“需要人工确认”。当前项目禁止自动执行 rollback、restart service、modify configuration。

## Java 网关边界

`apps/java-api` 用于体现 Java 后端工程能力：

- Spring Boot 3
- MySQL / JPA
- Redis TTL 缓存
- Actuator
- REST API
- 诊断任务与审计

Java 网关不替代 Agent Runtime，不新增大规模微服务拆分。当前主链路仍然是 Node.js API 调度 Agent Runtime，Agent Runtime 通过 MCP Client 调用 MCP Server。

## 验证命令

```bash
npm run check
npm run mcp:verify
npm run cli -- diagnose inc-20260824-001
```

Java 网关：

```bash
cd apps/java-api
mvn -s settings.xml test
```
