# AIOps Sentinel

AIOps Sentinel 是一个面向线上故障处置场景的智能运维控制台。系统以“告警进入、证据采集、Agent 诊断、处置建议、过程留痕”为主线，把日志、指标、服务依赖、AI 诊断和本地 CLI 串成一个完整的故障处理流程。

项目采用前后端分离和 monorepo 结构，前端负责运维控制台交互，后端提供鉴权、数据聚合、诊断任务调度和审计接口，核心包沉淀 MCP 风格工具、Agent 编排、DeepSeek 适配器和通用类型，本地 CLI 用于终端侧排障。

## 核心功能

- 故障控制台：展示服务告警、故障等级、负责人、服务依赖、接口延迟、错误率和近期日志。
- 登录鉴权：基于账号密码登录，使用 Bearer Token 访问受保护接口。
- 权限信息：登录后展示当前用户、团队和管理员角色，用于区分控制台访问身份。
- 异步诊断任务：创建诊断任务后由后端调度 Agent 流程，前端轮询任务状态并实时展示结果。
- Agent 诊断：自动调用日志查询、指标查询、依赖追踪、告警摘要和回滚建议工具，生成根因、影响范围、修复建议、置信度和证据链。
- DeepSeek 接入：支持通过 `.env` 配置真实 DeepSeek API，并提供本地降级策略，保证开发和排障流程稳定。
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

### Agent 与工具层

核心包 `packages/core` 负责沉淀与业务无关的诊断能力：

- `log_search`：按服务查询关键日志。
- `metric_query`：读取服务延迟、错误率等指标序列。
- `dependency_trace`：分析当前服务上下游依赖。
- `incident_summary`：聚合告警摘要。
- `rollback_advisor`：根据故障证据生成回滚判断。

Agent 会按步骤调用这些工具，将结果整理为证据链，并交给 DeepSeek 或本地诊断逻辑生成结论。

### 工程化沉淀

- `rules/`：项目协作和 AI Coding 规则。
- `skills/`：日志分析、故障复盘、代码审查等可复用技能。
- `prompts/`：故障诊断和发布风险分析提示词。
- `docs/architecture.md`：系统架构说明。

## 项目结构

```text
apps/web         React 运维控制台
apps/api         Node.js API 服务
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

默认访问地址：

```text
前端：http://localhost:5173
后端：http://localhost:8787
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
GET  /api/diagnosis-tasks
GET  /api/diagnosis-tasks/:taskId
POST /api/tools/:toolName
POST /api/incidents/:incidentId/diagnose
POST /api/incidents/:incidentId/diagnosis-tasks
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

## 常用命令

类型检查：

```bash
npm run check
```

生产构建：

```bash
npm run build
```
