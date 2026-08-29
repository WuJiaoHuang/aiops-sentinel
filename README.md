# AIOps Sentinel

**AIOps Sentinel is an LLM Agent based intelligent incident diagnosis platform using dynamic Tool Calling and MCP.**

AIOps Sentinel 的定位不是传统 CRUD 后端，而是一个基于 **LLM Agent + MCP** 的智能故障诊断平台。它围绕线上故障排查流程，展示动态 Tool Calling、MCP 工具协议、Agent Trace、AI Coding 规则、系统稳定性设计和 Human-in-the-loop 处置闭环。

## 架构总览

```text
Incident
   ↓
Agent Runtime
   ↓
LLM 决策：是否继续调用工具、调用哪个工具、使用什么参数
   ↓
MCP Client
   ↓
MCP Server
   ↓
Logs / Metrics / Dependency / Knowledge / Service Health
   ↓
Evidence + Agent Trace + ActionProposal
   ↓
Final Diagnosis
```

代码结构：

```text
apps/web              React 运维控制台，展示诊断结论、证据链、Agent Trace 和人工确认动作
apps/api              Node.js API，负责登录、控制台数据、异步诊断任务和审计
apps/java-api         Spring Boot Java 网关，用于体现 Java 后端、MySQL、Redis、Actuator 能力
packages/core         Agent Runtime、Tool Contract、Tool Registry、MCP Client、DeepSeek 适配器
packages/mcp-server   基于官方 MCP SDK 的 stdio MCP Server
packages/cli          本地排障 CLI
rules                 AI Coding 规则
skills                可复用 AI Coding / 运维排障 Skill
prompts               Agent 提示词模板
docs                  架构说明
```

## 核心能力

- 动态 Tool Calling Agent：每轮读取 AgentState，由 LLM 决定下一步 Tool，而不是写死日志、指标、依赖的顺序。
- 统一 Tool Contract：所有 Tool 都包含 `name`、`description`、JSON Schema 参数定义、`execute()` 和标准 `ToolResult`。
- 真实 MCP：Agent Runtime 通过 MCP Client 连接 MCP Server，使用官方 MCP SDK 执行 `listTools` 和 `callTool`。
- Agent Trace：每次诊断记录 LLM 决策、Tool 调用、失败、终止和最终诊断。
- 稳定性设计：LLM 调用包含 timeout、retry、exponential backoff 和 fallback；Tool 失败会写入 Trace，不会直接拖垮 Agent。
- Human-in-the-loop：`rollback_advisor` 只生成 ActionProposal，不自动执行回滚、重启或配置修改；中高风险动作必须人工确认。
- AI Coding 工程化：通过 `AGENTS.md`、`rules/`、`skills/`、`prompts/` 约束 AI 协作流程。

## AgentState

Agent 每轮维护统一状态：

```ts
type AgentState = {
  messages: AgentMessage[];
  incident: Incident;
  evidence: EvidenceItem[];
  toolCalls: ToolCallRecord[];
  currentHypothesis: string;
  confidence: number;
  stepCount: number;
  finalDiagnosis: Diagnosis | null;
};
```

执行规则：

1. 读取当前 Incident、Evidence、历史 Tool Result、Hypothesis 和 Confidence。
2. 调用 LLM 生成结构化决策。
3. 如果需要 Tool，选择 Tool 和参数。
4. 通过 MCP Client 调用 MCP Server。
5. 将 ToolResult 写入 evidence、messages、toolCalls 和 Agent Trace。
6. 检测重复 Tool Call，相同工具和相同参数会去重。
7. 达到终止条件时输出最终诊断。
8. 最多执行 `maxSteps=8` 次 Tool Call。
9. 证据不足时允许输出“不确定”，不会强行编造根因。

## MCP Server

MCP Server 位于 `packages/mcp-server`，使用官方 `@modelcontextprotocol/sdk` 和 stdio transport。

对外暴露工具：

```text
incident_summary
query_logs
query_metrics
query_dependency
get_service_health
search_knowledge
rollback_advisor
```

启动 MCP Server：

```bash
npm run mcp:start
```

最小可复现测试：

```bash
npm run mcp:verify
```

该命令会启动 MCP Client，连接 stdio MCP Server，执行：

```text
listTools
callTool: query_logs
```

也可以使用同义测试命令：

```bash
npm run test:mcp
```

## Tool Contract

所有 Tool 统一通过 `toolRegistry` 注册：

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

当前保留并完善的工具：

```text
incident_summary
log_search
metric_query
dependency_trace
knowledge_search
service_health
rollback_advisor
```

Agent 不直接依赖工具实现，只通过 Tool Registry 获取定义，再通过 MCP Client 调用 MCP Server。

## Agent Trace

每次诊断会生成 AgentRun：

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

每个 AgentStep 包含：

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

前端控制台的“诊断过程”区域会按顺序展示这些步骤，例如：

```text
Step 1：LLM 判断需要调用 service_health
Step 2：调用 MCP Tool：get_service_health
Step 3：发现服务健康状态 critical，P99 latency 810ms，error rate 12.5%
Step 4：LLM 判断需要调用 metric_query
Step 5：调用 MCP Tool：query_metrics
Step 6：LLM 判断需要调用 log_search
Step 7：发现支付服务重试预算耗尽后仍然超时
Step 8：生成根因判断和高风险 ActionProposal
```

## Human-in-the-loop

对线上系统有影响的操作不会自动执行，只生成 ActionProposal：

```ts
type ActionProposal = {
  action: string;
  reason: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  evidence: string[];
  requiresApproval: boolean;
};
```

规则：

- `LOW`：可以作为低风险建议展示。
- `MEDIUM`：必须显示“需要人工确认”。
- `HIGH`：必须显示“需要人工确认”。
- `rollback_advisor` 只输出建议，不执行 rollback。
- 当前项目不自动执行重启服务、回滚版本或修改配置。

## 完整 Demo Case

示例故障：`order-service latency alert`

```text
1. Incident 进入系统：下单接口错误率突增，影响 order-service。
2. Agent 读取 AgentState，当前没有证据，LLM 选择 service_health。
3. MCP Client 调用 MCP Server 的 get_service_health。
4. Tool 返回 P99 latency 810ms、error rate 12.5%，服务状态 critical。
5. Agent 更新 Evidence 和 Hypothesis，LLM 选择 metric_query。
6. MCP Server 返回指标窗口，确认错误率和延迟持续升高。
7. LLM 选择 log_search。
8. MCP Server 返回日志：支付服务重试预算耗尽后仍然超时。
9. LLM 根据 timeout 信号选择 dependency_trace。
10. Agent 发现 order-service 依赖 payment-service、inventory-service。
11. LLM 选择 knowledge_search，召回订单链路超时 Runbook。
12. LLM 选择 rollback_advisor，生成高风险回滚 ActionProposal。
13. Agent 输出最终诊断：根因大概率与支付链路超时和发布风险相关，并给出证据和人工确认动作。
```

运行：

```bash
npm install
npm run mcp:verify
npm run cli -- diagnose inc-20260824-001
```

## 本地启动

启动 Node.js API：

```bash
npm run dev:api
```

启动前端：

```bash
npm run dev
```

启动 Java 网关：

```bash
cd apps/java-api
mvn spring-boot:run
```

默认地址：

```text
前端：http://localhost:5173
Node.js API：http://localhost:8787
Java 网关：http://localhost:8080
```

## 演示账号

```text
账号：admin
密码：aiops2026
```

## DeepSeek 配置

项目根目录创建 `.env`：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
VITE_API_BASE_URL=http://localhost:8787
MYSQL_URL=jdbc:mysql://localhost:3306/aiops_sentinel?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai
MYSQL_USERNAME=root
MYSQL_PASSWORD=
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DATABASE=0
JAVA_API_PORT=8080
AI_SERVICE_BASE_URL=http://localhost:8787
AIOPS_TOOL_TIMEOUT_MS=5000
```

`.env` 已加入 `.gitignore`，不会提交到 GitHub。

## API 接口

```text
GET  /health
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout
GET  /api/ai/status
POST /api/ai/test
GET  /api/services
GET  /api/incidents
GET  /api/console
GET  /api/audit-events
GET  /api/logs
GET  /api/metrics/:serviceId
GET  /api/tools
GET  /api/diagnosis-tasks
GET  /api/diagnosis-tasks/:taskId
POST /api/tools/:toolName
POST /api/incidents/:incidentId/diagnose
POST /api/incidents/:incidentId/diagnosis-tasks
```

Java 网关接口：

```text
GET  /health
GET  /api/ai/status
GET  /api/incidents
POST /api/diagnosis-tasks
GET  /api/diagnosis-tasks
GET  /api/diagnosis-tasks/:taskId
GET  /api/audit-events
GET  /actuator/health
GET  /actuator/metrics
```

## 常用命令

```bash
npm run check
npm run mcp:verify
npm run test:mcp
npm run cli -- diagnose inc-20260824-001
npm run build
```

Java 网关测试：

```bash
cd apps/java-api
mvn -s settings.xml test
```

## 岗位能力覆盖

优先体现 AI Agent 和 AIOps：

- LLM Agent 动态决策
- Tool Calling
- MCP Server / MCP Client
- Agent Trace 可观测性
- 故障证据链
- 不确定诊断
- 稳定性和失败兜底
- Human-in-the-loop 风险控制

同时保留 Java 后端岗位可讲内容：

- Spring Boot 3
- MySQL / JPA
- Redis TTL 缓存
- Actuator
- REST API
- 异步任务
- 审计记录

本轮不引入 Kafka、Kubernetes、多 Agent、复杂权限系统或自动修复，先保证 LLM Agent + MCP 主链路清晰、可运行、可展示。
