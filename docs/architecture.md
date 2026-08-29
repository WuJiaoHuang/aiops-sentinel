# Architecture

## Runtime Flow

1. 用户打开 React 故障控制台并选择一条故障。
2. 用户通过演示账号登录，后端签发内存 token。
3. 前端携带 token 请求 API，获取服务、告警、日志、指标和历史诊断任务。当前保留 Node.js API，新增 Spring Boot Java API 作为后端主网关演进方向。
4. 如果 API 不可用，前端自动切换到本地 mock 数据，保证演示稳定。
5. 用户触发诊断后，API 先创建 running 状态的异步诊断任务。
6. 前端轮询 `GET /api/diagnosis-tasks/:taskId` 获取任务进度。
7. 后端任务队列调用 Agent，Agent 通过 MCP Client 连接 `packages/mcp-server`，执行 `listTools` 和 `callTool`，收集日志、指标、依赖、Runbook 知识和回滚建议。
8. DeepSeek adapter 在存在 API Key 时生成真实诊断结论。
9. DeepSeek 返回内容会经过 JSON 提取和字段归一化，避免 Markdown 包裹或字段缺失导致页面异常。
10. 如果 DeepSeek 不可用，系统返回确定性的 mock 诊断结果。
11. API 将 completed 诊断任务写入 SQLite，前端展示诊断结论、步骤流和历史记录。

## Spring Boot Java 网关

`apps/java-api` 是面向 Java 后端岗位的主后端演进版本，负责承接更接近真实业务系统的后端职责：

- Spring Boot Web：提供健康检查、诊断任务创建、AI 状态代理等 REST 接口。
- MySQL：通过 Spring Data JPA 管理告警、诊断任务和审计事件，作为业务数据主存储。
- Redis：通过 `StringRedisTemplate` 缓存诊断任务状态，并设置 30 分钟 TTL；Redis 不可用时降级到 MySQL。
- Actuator：暴露健康检查、指标和 Prometheus 采集端点。
- AI Service Proxy：通过 `RestClient` 对接现有 Node.js/后续 Python AI 服务，形成 Java 业务后端 + AI Runtime 的分层架构。

推荐面试表达：

```text
我把原项目从单一 Node.js 后端演进为 Spring Boot 业务网关 + AI Agent Runtime 的架构。
Java 后端负责鉴权、任务、审计、MySQL/Redis 和可观测接口，AI Runtime 专注工具调用、RAG 和模型推理。
```

当前 Java 网关已经包含：

- `IncidentEntity` / `IncidentRepository`：管理告警数据。
- `DiagnosisTaskEntity` / `DiagnosisTaskRepository`：持久化诊断任务。
- `AuditEventEntity` / `AuditEventRepository`：记录关键操作审计。
- `TaskCacheService`：将诊断任务写入 Redis，并在 Redis 不可用时回退到 MySQL。
- `JavaApiIntegrationTest`：用 H2 验证 Controller、JPA、任务创建和审计闭环。

## Real MCP Server

`packages/mcp-server` 是真实 MCP Server，而不是普通工具封装。它使用官方 `@modelcontextprotocol/sdk`：

- `McpServer` 注册工具。
- `StdioServerTransport` 提供 stdio transport。
- `registerTool` 暴露 `incident_summary`、`metric_query`、`log_search`、`dependency_trace`、`knowledge_search`、`rollback_advisor`。
- `registerResource` 暴露 `aiops://tools/catalog` 工具目录资源。

验证命令：

```bash
npm run mcp:verify
```

该命令会启动 MCP Client，连接 stdio MCP Server，先执行 `listTools`，再调用 `log_search`。

## MCP 工具契约

Every tool follows the same structure:

```ts
type ToolResult<T> = {
  result: T;
  metadata: {
    tool: ToolName;
    durationMs: number;
    mock: boolean;
  };
};
```

这样可以让同一套底层工具同时复用于 API、CLI、前端 fallback、本地 MCP Server 和 Agent 工作流。

## Agent 工作流

当前诊断 Agent 的流程已经从固定串行调用升级为 MCP + 计划驱动：

- 通过 MCP Client 启动并连接 stdio MCP Server。
- 调用 MCP `listTools` 获取真实工具清单。
- 根据故障等级、状态和影响服务生成工具调用计划。
- 读取故障上下文，避免脱离告警场景排查。
- 查询最新指标窗口，判断错误率、延迟、CPU、内存异常。
- 检索受影响服务 error 日志，提取运行时错误信号。
- 追踪服务依赖关系，判断故障是否由下游服务扩散。
- 检索 Runbook 和历史处置知识，形成轻量 RAG 证据。
- 通过 MCP `callTool` 调用回滚建议工具，输出行动建议。
- 汇总证据链。
- 调用 DeepSeek 或 mock fallback 生成诊断结论。
- 返回诊断步骤流、工具耗时、证据链和最终结论。

这种设计可以继续演进为 LLM Tool Calling 或 LangGraph 工作流：工具目录已经独立为 `toolCatalog`，API 也通过 `GET /api/tools` 暴露工具能力。

## SQLite 持久化

API 启动时会自动创建 `data/sentinel.sqlite`，并写入服务、告警、日志、指标等种子数据。

每次调用 `POST /api/incidents/:incidentId/diagnose` 后，系统都会保存一条诊断任务，包含：

- 任务 ID
- 故障 ID
- 开始和完成时间
- Agent 步骤流
- 工具调用耗时
- 最终诊断结论

下一阶段可以继续扩展为流式步骤推送、真实指标接入、用户处置记录和 Java 侧 MySQL 任务表。

## 异步诊断任务

平台同时保留同步诊断和异步诊断两种接口：

- `POST /api/incidents/:incidentId/diagnose`：兼容 CLI 和快速接口测试。
- `POST /api/incidents/:incidentId/diagnosis-tasks`：创建异步任务，立即返回 running 状态。
- `GET /api/diagnosis-tasks/:taskId`：查询任务状态，前端用它做轮询。

这种设计更接近真实 Agent 工作流：前端不会被模型调用阻塞，后端可以把耗时诊断过程抽象为任务。

## 登录与接口保护

当前版本实现了演示级登录闭环：

- `POST /api/auth/login`：校验演示账号并签发 token。
- `GET /api/auth/me`：校验当前登录态。
- `POST /api/auth/logout`：清理服务端会话。
- 控制台、日志、指标、诊断任务等业务接口都需要携带 Bearer token。

这个设计适合作品集演示登录态、受保护接口和前后端鉴权流程；后续可以替换为数据库用户表、密码哈希和 JWT。

## DeepSeek 集成

后端通过 `.env` 读取 DeepSeek 配置：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

API 提供两个联调接口：

- `GET /api/ai/status`：查看当前是否配置 DeepSeek。
- `POST /api/ai/test`：使用内置故障执行一次测试诊断。

诊断结果里的 `modelSource` 用于区分真实模型和 mock 兜底，前端会直接展示这个状态。

## 岗位覆盖路线

优先覆盖京东 Java 后端实习：

- Java 17、Spring Boot、REST API、参数校验、配置化。
- MySQL JPA Entity/Repository、Redis TTL 缓存、Actuator、Prometheus 观测入口。
- 异步诊断任务、审计、网关转发、服务分层。

同时覆盖常见 AI 工程岗位：

- Agent 计划与工具调用。
- 真实 MCP Server 与 MCP Client 调用链路。
- RAG/Runbook 证据召回。
- DeepSeek 模型接入与 mock fallback。
- AI 诊断结果结构化、证据链、置信度和回滚建议。
