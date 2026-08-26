# Architecture

## Runtime Flow

1. 用户打开 React 故障控制台并选择一条故障。
2. 前端优先请求 Node.js API 获取服务、告警、日志、指标和历史诊断任务。
3. 如果 API 不可用，前端自动切换到本地 mock 数据，保证演示稳定。
4. 用户触发诊断后，API 先创建 running 状态的异步诊断任务。
5. 前端轮询 `GET /api/diagnosis-tasks/:taskId` 获取任务进度。
6. 后端任务队列调用 Agent，Agent 依次调用 MCP 风格工具，收集日志、指标、依赖和回滚建议。
7. DeepSeek adapter 在存在 API Key 时生成真实诊断结论。
8. DeepSeek 返回内容会经过 JSON 提取和字段归一化，避免 Markdown 包裹或字段缺失导致页面异常。
9. 如果 DeepSeek 不可用，系统返回确定性的 mock 诊断结果。
10. API 将 completed 诊断任务写入 SQLite，前端展示诊断结论、步骤流和历史记录。

## MCP 风格工具契约

Every tool follows the same structure:

```ts
type ToolResult<T> = {
  result: T;
  metadata: {
    tool: string;
    durationMs: number;
    mock: boolean;
  };
};
```

这样可以让同一套工具同时复用于 API、CLI、前端演示和 Agent 工作流。

## Agent 工作流

当前诊断 Agent 的流程是确定性的：

- 读取故障上下文。
- 检索受影响服务日志。
- 查询最新指标窗口。
- 追踪服务依赖关系。
- 调用回滚建议工具。
- 汇总证据链。
- 调用 DeepSeek 或 mock fallback 生成诊断结论。
- 返回诊断步骤流、工具耗时、证据链和最终结论。

## SQLite 持久化

API 启动时会自动创建 `data/sentinel.sqlite`，并写入服务、告警、日志、指标等种子数据。

每次调用 `POST /api/incidents/:incidentId/diagnose` 后，系统都会保存一条诊断任务，包含：

- 任务 ID
- 故障 ID
- 开始和完成时间
- Agent 步骤流
- 工具调用耗时
- 最终诊断结论

下一阶段可以继续扩展为流式步骤推送、真实指标接入和用户处置记录。

## 异步诊断任务

平台同时保留同步诊断和异步诊断两种接口：

- `POST /api/incidents/:incidentId/diagnose`：兼容 CLI 和快速接口测试。
- `POST /api/incidents/:incidentId/diagnosis-tasks`：创建异步任务，立即返回 running 状态。
- `GET /api/diagnosis-tasks/:taskId`：查询任务状态，前端用它做轮询。

这种设计更接近真实 Agent 工作流：前端不会被模型调用阻塞，后端可以把耗时诊断过程抽象为任务。

## DeepSeek 集成

后端通过 `.env` 读取 DeepSeek 配置：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

API 提供两个联调接口：

- `GET /api/ai/status`：查看当前是否配置 DeepSeek。
- `POST /api/ai/test`：使用内置故障执行一次测试诊断。

诊断结果里的 `modelSource` 用于区分真实模型和 mock 兜底，前端会直接展示这个状态。
