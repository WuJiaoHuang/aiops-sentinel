# AIOps Sentinel

**AIOps Sentinel** 是一个面向智能运维场景的全栈 AI 项目，用来模拟线上服务发生故障后，系统如何结合日志、指标、服务依赖和 AI Agent 自动完成故障诊断。

这个项目的目标不是做一个简单的 CRUD 页面，而是完整展示：

- HTML5 / CSS3 / JavaScript / TypeScript / React 前端开发能力
- Node.js / Express 服务端开发能力
- AI Coding 工程化实践
- MCP 风格工具调用设计
- CLI 工具开发
- Rules / Skills / Prompts 沉淀
- Agent 多步骤诊断流程

## 当前已实现功能

- 运维控制台页面：
  - 登录页和退出登录
  - 展示当前用户、团队和权限角色
  - 展示故障告警
  - 支持故障队列切换
  - 展示服务信息
  - 展示接口延迟、错误率等模拟指标
  - 展示服务日志
  - 展示 AI Agent 生成的根因分析、影响范围、修复建议和置信度
  - 展示 Agent 步骤流、工具调用名称和耗时
  - 支持后端 API 不可用时自动切换到本地 mock 数据
  - 展示最近操作审计日志，覆盖登录、退出、查看控制台、创建诊断任务
- Node.js API 服务：
  - `GET /health`
  - `POST /api/auth/login`
  - `GET /api/auth/me`
  - `POST /api/auth/logout`
  - `GET /api/ai/status`
  - `POST /api/ai/test`
  - `GET /api/services`
  - `GET /api/incidents`
  - `GET /api/console`
  - `GET /api/audit-events`
  - `GET /api/logs`
  - `GET /api/metrics/:serviceId`
  - `GET /api/diagnosis-tasks`
  - `GET /api/diagnosis-tasks/:taskId`
  - `POST /api/tools/:toolName`
  - `POST /api/incidents/:incidentId/diagnose`
  - `POST /api/incidents/:incidentId/diagnosis-tasks`
- SQLite 持久化：
  - API 启动时自动创建 `data/sentinel.sqlite`
  - 自动写入服务、告警、日志、指标等种子数据
  - 每次 Agent 诊断都会保存为一条诊断任务
  - 登录、退出、查看控制台、创建诊断任务会写入操作审计日志
  - 前端可以查看当前故障的历史诊断记录
  - 异步任务完成后会写入 SQLite，刷新页面后仍可查看
- MCP 风格工具层：
  - `log_search`：查询服务日志
  - `metric_query`：查询服务指标
  - `dependency_trace`：分析服务依赖
  - `incident_summary`：生成告警摘要
  - `rollback_advisor`：判断是否需要回滚
- AI Agent 诊断流程：
  - 接收告警 ID
  - 创建异步诊断任务，前端轮询任务状态
  - 自动调用日志、指标、依赖、回滚建议等工具
  - 汇总证据链
  - 返回每一步诊断动作、工具名称、耗时和执行摘要
  - 调用 DeepSeek 生成诊断结果
  - 如果没有配置 DeepSeek API Key，则自动使用 mock 结果，保证本地演示稳定
  - 前端会显示当前诊断来自真实 DeepSeek 还是 mock 兜底
- 本地 CLI 工具：
  - `scan`：扫描当前服务和告警
  - `diagnose <incidentId>`：诊断指定故障
  - `logs <serviceId>`：查看服务日志
  - `report <incidentId>`：生成故障报告
- 工程化资料：
  - `rules/`：AI Coding 规则
  - `skills/`：日志分析、故障复盘、代码审查技能
  - `prompts/`：诊断和发布风险分析提示词
  - `docs/`：架构说明和简历项目写法

## 技术栈

- 前端：HTML5、CSS3、JavaScript、TypeScript、React、Vite
- 后端：Node.js、TypeScript、Express
- AI：DeepSeek API、Agent 工作流、Prompt 模板
- 工程化：CLI、MCP 风格工具契约、Rules、Skills、ESLint、TypeScript 类型检查

## 本地启动

安装依赖：

```bash
npm install
```

启动后端 API：

```bash
npm run dev:api
```

另开一个终端启动前端页面：

```bash
npm run dev
```

前端默认运行在：

```text
http://localhost:5173
```

后端默认运行在：

```text
http://localhost:8787
```

## 演示账号

本地默认演示账号：

```text
账号：admin
密码：aiops2026
```

可以通过 `.env` 修改：

```bash
DEMO_USERNAME=admin
DEMO_PASSWORD=aiops2026
```

登录成功后，前端会把后端返回的 token 保存在浏览器 localStorage 中，并在请求控制台数据、诊断任务、日志和指标时带上 `Authorization: Bearer <token>`。

当前演示账号内置为“管理员”角色，页面会展示用户姓名、团队、权限角色，并通过操作审计记录关键行为。这个设计是为了体现后台系统常见的“登录鉴权 + 权限提示 + 操作留痕”能力。

## DeepSeek 配置

项目支持真实 DeepSeek API，也支持没有 Key 时自动 mock。

如果要接入真实 DeepSeek，在项目根目录创建 `.env` 文件：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
VITE_API_BASE_URL=http://localhost:8787
```

注意：`.env` 已经加入 `.gitignore`，不会提交到 GitHub。

如果没有配置 `DEEPSEEK_API_KEY`，系统仍然可以完整运行，只是 AI 诊断结果会使用本地 mock，方便稳定演示。

配置完成后可以用下面的接口检查当前 AI 模式：

```bash
curl http://localhost:8787/api/ai/status
curl -X POST http://localhost:8787/api/ai/test
```

如果 `modelSource` 返回 `deepseek`，说明真实 DeepSeek 调用成功；如果返回 `mock`，说明当前正在使用本地兜底结果。

## 数据库说明

本项目使用 Node.js 自带的 SQLite 能力，数据库文件会自动生成在：

```text
data/sentinel.sqlite
```

这个文件属于本地运行数据，已经加入 `.gitignore`，不会提交到 GitHub。

审计日志保存在 `audit_events` 表中，前端“操作审计”面板默认展示最近 6 条，接口 `GET /api/audit-events` 默认返回最近 30 条。

## CLI 使用

```bash
npm run cli -- scan
npm run cli -- diagnose inc-20260824-001
npm run cli -- logs svc-order
npm run cli -- report inc-20260824-001
```

## 项目结构

```text
apps/web        React 运维控制台
apps/api        Node.js API 服务
packages/core   模拟数据、MCP 工具、Agent 流程、DeepSeek 适配器
packages/cli    本地 Sentinel CLI
rules           AI Coding 规则
skills          可复用 AI 工作流技能
prompts         Agent 提示词模板
docs            架构说明和简历材料
```

## 下一阶段计划

- 增加更多服务、日志、指标和故障类型
- 增加测试用例和部署说明
- 增加更细粒度的角色权限，例如只读成员、值班工程师、管理员
