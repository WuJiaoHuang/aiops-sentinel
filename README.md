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
  - 展示故障告警
  - 展示服务信息
  - 展示接口延迟、错误率等模拟指标
  - 展示服务日志
  - 展示 AI Agent 生成的根因分析、影响范围、修复建议和置信度
- Node.js API 服务：
  - `GET /health`
  - `GET /api/services`
  - `GET /api/incidents`
  - `GET /api/logs`
  - `GET /api/metrics/:serviceId`
  - `POST /api/tools/:toolName`
  - `POST /api/incidents/:incidentId/diagnose`
- MCP 风格工具层：
  - `log_search`：查询服务日志
  - `metric_query`：查询服务指标
  - `dependency_trace`：分析服务依赖
  - `incident_summary`：生成告警摘要
  - `rollback_advisor`：判断是否需要回滚
- AI Agent 诊断流程：
  - 接收告警 ID
  - 自动调用日志、指标、依赖、回滚建议等工具
  - 汇总证据链
  - 调用 DeepSeek 生成诊断结果
  - 如果没有配置 DeepSeek API Key，则自动使用 mock 结果，保证本地演示稳定
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

## DeepSeek 配置

项目支持真实 DeepSeek API，也支持没有 Key 时自动 mock。

如果要接入真实 DeepSeek，在项目根目录创建 `.env` 文件：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

注意：`.env` 已经加入 `.gitignore`，不会提交到 GitHub。

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

- 前端改为真正调用后端 API，而不是直接读取本地 core 数据
- 增加诊断任务状态和 Agent 步骤流
- 增加更多服务、日志、指标和故障类型
- 增加数据库持久化
- 增加测试用例和部署说明
