# AIOps Sentinel

AIOps Sentinel 是一个面向线上故障处置场景的智能运维控制台。系统以“告警进入、证据采集、Agent 诊断、处置建议、过程留痕”为主线，把日志、指标、服务依赖、AI 诊断和本地 CLI 串成一个完整的故障处理流程。

项目采用前后端分离和 monorepo 结构，前端负责运维控制台交互，后端提供鉴权、数据聚合、诊断任务调度和审计接口，核心包沉淀 MCP 风格工具、Agent 编排、DeepSeek 适配器和通用类型，本地 CLI 用于终端侧排障。

当前版本新增了 `apps/java-api`，把项目从单一 Node.js 后端演进为：

```text
React 控制台
   ↓
Spring Boot Java API：鉴权 / 任务 / 审计 / MySQL / Redis / Actuator
   ↓
AI Agent Runtime：工具规划 / MCP Client / MCP Server / RAG 知识检索 / DeepSeek
```

这个方向优先匹配 Java 后端实习岗位，同时保留 AI 应用、Agent、AIOps、LLM 工程岗位常见能力。

## 核心功能

- 故障控制台：展示服务告警、故障等级、负责人、服务依赖、接口延迟、错误率和近期日志。
- 登录鉴权：基于账号密码登录，使用 Bearer Token 访问受保护接口。
- 权限信息：登录后展示当前用户、团队和管理员角色，用于区分控制台访问身份。
- 异步诊断任务：创建诊断任务后由后端调度 Agent 流程，前端轮询任务状态并实时展示结果。
- Agent 诊断：自动调用日志查询、指标查询、依赖追踪、告警摘要和回滚建议工具，生成根因、影响范围、修复建议、置信度和证据链。
- DeepSeek 接入：支持通过 `.env` 配置真实 DeepSeek API，并提供本地降级策略，保证开发和排障流程稳定。
- Spring Boot 网关：新增 Java 17 后端模块，预置 MySQL、Redis、Actuator 和 AI 服务代理能力。
- 计划驱动 Agent：Agent 会先生成诊断计划，再调用日志、指标、依赖、Runbook 知识和回滚建议工具。
- 真实 MCP Server：通过官方 MCP TypeScript SDK 和 stdio transport 暴露日志、指标、依赖、知识库和回滚建议工具。
- MCP Client Agent：后端和 CLI 诊断流程会启动 MCP Server，并通过 MCP `listTools` / `callTool` 获取证据。
- SQLite 持久化：保存服务、告警、日志、指标、诊断任务和操作审计记录。
- 操作审计：记录登录、退出、查看控制台、创建诊断任务等关键行为，控制台可查看最近操作记录。
- CLI 排障：提供扫描、诊断、日志查询、报告生成等命令，支持在终端完成故障分析。

## 技术实现

### 前端控制台

- 使用 React + TypeScript + Vite 构建单页应用。
- 使用 HTML5 / CSS3 完成响应式布局、登录页、侧边栏、指标图、诊断面板、证据链、历史记录和审计列表。
- 使用 `fetch` 封装统一请求逻辑，自动携带 `Authorization` token。
- 在 API 不可用、鉴权失效或服务降级时提供清晰的中文状态提示。

### 后端服务

- 使用 Node.js + Express + TypeScript 提供 REST API。
- 使用内存会话保存登录 token，并通过中间件保护业务接口。
- 使用 Node.js SQLite 能力持久化本地数据，启动时自动初始化表结构和种子数据。
- 诊断任务采用异步执行方式，任务创建后立即返回，后台继续执行 Agent 流程。

### Java 后端网关

- 使用 Java 17 + Spring Boot 3 构建 `apps/java-api`。
- 预置 Spring Web、Validation、JPA、Redis、Actuator 和 MySQL Driver。
- 使用 JPA Entity + Repository 管理告警、诊断任务和审计事件。
- 创建诊断任务时写入 MySQL，并将任务状态以 TTL 方式写入 Redis。
- 通过环境变量配置 MySQL、Redis、Java API 端口和 AI Runtime 地址。
- 提供 `/health`、`/api/incidents`、`/api/diagnosis-tasks`、`/api/audit-events`、`/api/ai/status` 等接口，作为后续替换 Node.js 主后端的入口。

### MCP Server、Agent 与工具层

核心包 `packages/core` 负责沉淀与业务无关的诊断能力：

- `log_search`：按服务查询关键日志。
- `metric_query`：读取服务延迟、错误率等指标序列。
- `dependency_trace`：分析当前服务上下游依赖。
- `incident_summary`：聚合告警摘要。
- `knowledge_search`：检索 Runbook 和历史处置知识，提供 RAG 型证据。
- `rollback_advisor`：根据故障证据生成回滚判断。

`packages/mcp-server` 使用官方 MCP TypeScript SDK 将这些能力注册为真实 MCP tools，并通过 stdio transport 对外提供服务。

后端和 CLI 使用 `@aiops-sentinel/core/agent`，该 Agent 会先通过 MCP Client 连接 MCP Server，执行 `listTools` 获取工具能力，再通过 `callTool` 调用对应工具，将结果整理为证据链，并交给 DeepSeek 或本地诊断逻辑生成结论。

### 工程化沉淀

- `rules/`：项目协作和 AI Coding 规则。
- `skills/`：日志分析、故障复盘、代码审查等可复用技能。
- `prompts/`：故障诊断和发布风险分析提示词。
- `docs/architecture.md`：系统架构说明。

## 项目结构

```text
apps/web         React 运维控制台
apps/api         Node.js API 服务
apps/java-api    Spring Boot Java 业务网关
packages/mcp-server 真实 MCP Server，stdio transport
packages/core    种子数据、MCP 风格工具、Agent 流程、DeepSeek 适配器
packages/cli     本地 Sentinel CLI
rules            AI Coding 规则
skills           可复用工作流技能
prompts          Agent 提示词模板
docs             架构文档
data             本地 SQLite 数据目录
```

## 本地启动

安装依赖：

```bash
npm install
```

启动后端 API：

```bash
npm run dev:api
```

启动前端控制台：

```bash
npm run dev
```

启动 Java 网关：

```bash
cd apps/java-api
mvn spring-boot:run
```

启动 MCP Server：

```bash
npm run mcp:start
```

验证 MCP Server：

```bash
npm run mcp:verify
```

`mcp:verify` 会通过 MCP Client 连接 stdio server，执行 `listTools`，再调用一次 `log_search`。这可以证明当前不是“工具风格模拟”，而是真实 MCP 协议调用。

默认访问地址：

```text
前端：http://localhost:5173
后端：http://localhost:8787
Java 网关：http://localhost:8080
```

## 演示账号

```text
账号：admin
密码：aiops2026
```

账号密码可以通过项目根目录 `.env` 修改：

```bash
DEMO_USERNAME=admin
DEMO_PASSWORD=aiops2026
```

登录成功后，前端会把后端返回的 token 保存在浏览器 localStorage 中，并在请求控制台数据、诊断任务、日志和指标时带上 `Authorization: Bearer <token>`。

## DeepSeek 配置

项目根目录创建 `.env` 文件：

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
```

`.env` 已加入 `.gitignore`，不会提交到 GitHub。

检查当前 AI 配置状态：

```bash
curl http://localhost:8787/api/ai/status
curl -X POST http://localhost:8787/api/ai/test
```

返回结果中的 `modelSource` 为 `deepseek` 时，表示诊断结果来自真实 DeepSeek；为 `mock` 时，表示当前使用本地诊断逻辑。

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

## 数据持久化

本地数据库文件会自动生成在：

```text
data/sentinel.sqlite
```

主要数据表包括服务、告警、日志、指标、诊断任务和操作审计。数据库文件属于本地运行数据，已加入 `.gitignore`。

## CLI 使用

```bash
npm run cli -- scan
npm run cli -- diagnose inc-20260824-001
npm run cli -- logs svc-order
npm run cli -- report inc-20260824-001
```

`diagnose` 命令默认走 MCP Agent，会拉起 `@aiops-sentinel/mcp-server`，通过 MCP tools 收集证据后再生成诊断。

## 常用命令

类型检查：

```bash
npm run check
```

生产构建：

```bash
npm run build
```

Java 网关测试：

```bash
cd apps/java-api
mvn -s settings.xml test
```

测试使用 H2 内存库验证 JPA、Controller、任务持久化和审计记录，不需要本机 MySQL/Redis 在线。
