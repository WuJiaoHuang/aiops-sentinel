# AGENTS.md

本文件约束 Codex、Claude Code 等 AI Coding Agent 在本项目中的改造方式。

## 项目定位

AIOps Sentinel 是基于 LLM Agent + MCP 的智能故障诊断平台。核心价值是动态 Tool Calling、真实 MCP、Agent Trace、故障排查证据链、稳定性设计和 Human-in-the-loop。

不要把项目重构成普通传统 Java CRUD 后端。Java 网关用于体现后端工程能力，Agent Runtime 和 MCP 才是诊断主链路。

## 架构边界

```text
Incident
  -> Agent Runtime
  -> LLM Decision
  -> MCP Client
  -> MCP Server
  -> Logs / Metrics / Dependency / Knowledge
  -> Agent Trace
  -> Final Diagnosis + ActionProposal
```

代码边界：

- `packages/core/src/agent.ts`：Node.js 后端和 CLI 使用的正式 Agent Runtime，只能通过 MCP Client 调用工具。
- `packages/core/src/mcpClient.ts`：MCP Client，负责 stdio 连接、工具名映射、timeout 和错误隔离。
- `packages/core/src/tools.ts`：Tool Contract 和 Tool Registry，新增 Tool 必须从这里注册。
- `packages/mcp-server/src/index.ts`：真实 MCP Server，使用官方 MCP SDK 注册对外工具。
- `apps/web`：展示诊断结论、证据链、Agent Trace 和人工确认动作。
- `apps/api`：登录、控制台数据、异步诊断任务和审计。
- `apps/java-api`：Java 网关、MySQL、Redis、Actuator，不承载 Agent 主编排。

## 代码风格

- TypeScript 使用显式类型，公共结构放在 `packages/core/src/types.ts`。
- README、提交信息、面向 GitHub 的说明默认使用中文。
- 保持现有 monorepo 结构，不新增无必要技术栈。
- 小步提交，每完成一个可验证阶段就运行检查并 push。
- 不把密码、Token、API Key 写进代码、README、测试或提交历史。

## 新增 Tool 规范

新增 Tool 必须遵循统一 Tool Contract：

```ts
type ToolDefinition = {
  name: ToolName;
  mcpName: McpToolName;
  description: string;
  inputSchema: JsonSchema;
  execute: (input, context) => Promise<ToolResult> | ToolResult;
};
```

标准返回：

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

要求：

1. 在 `ToolName` 和 `McpToolName` 中加入类型。
2. 在 `toolRegistry` 中实现 ToolDefinition。
3. 在 MCP Server 中注册对应 `registerTool`。
4. Agent 不能直接 import 并调用工具实现，必须通过 MCP Client。
5. Tool 失败必须返回 `success=false`，不要抛出未捕获异常。
6. 对线上有影响的 Tool 只能生成建议，不允许自动执行修复。

## Agent 规范

- 必须维护 AgentState：messages、incident、evidence、toolCalls、currentHypothesis、confidence、stepCount、finalDiagnosis。
- 每轮先由 LLM 或 fallback planner 做决策，再执行 Tool。
- 必须设置 `maxSteps`，默认不超过 8 次 Tool Call。
- 必须检测相同 Tool + 相同参数的重复调用。
- Tool 调用失败要写入 Agent Trace，不能导致整个 Agent 崩溃。
- 证据不足时允许输出“不确定”，不能强行编造根因。
- 中高风险动作必须生成 ActionProposal，并标记 `requiresApproval=true`。

## 禁止行为

- 禁止写死 `log_search -> metric_query -> dependency_trace` 这类固定诊断顺序。
- 禁止绕过 MCP Client 直接调用本地工具作为正式后端/CLI 诊断路径。
- 禁止自动执行 rollback、restart service、modify configuration。
- 禁止为了展示技术栈而引入 Kafka、Kubernetes、多 Agent 或复杂权限系统。
- 禁止提交 `.env`、数据库密码、API Key、Token。

## 修改前检查

```bash
git status --short
npm run check
npm run mcp:verify
```

如果改动 Java 网关：

```bash
cd apps/java-api
mvn -s settings.xml test
```

## 修改后测试

至少运行：

```bash
npm run check
npm run mcp:verify
npm run cli -- diagnose inc-20260824-001
```

如果改动前端体验，还需要启动前端和 API，确认“诊断过程”和 ActionProposal 正常展示。

如果改动 Java 网关，还需要运行：

```bash
cd apps/java-api
mvn -s settings.xml test
```
