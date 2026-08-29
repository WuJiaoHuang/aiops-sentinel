# Skill: 新增一个 MCP Tool

当需要为 AIOps Sentinel 新增日志、指标、依赖、知识库、健康检查或只读分析类 Tool 时，使用本 Skill。

## 目标

新增 Tool 必须同时满足：

- 遵循统一 Tool Contract。
- 注册到 Tool Registry。
- 注册到真实 MCP Server。
- 能被 Agent Runtime 通过 MCP Client 调用。
- 有最小验证方式。
- README 保持中文并同步更新。

## 步骤

1. 新建或更新 Tool Schema

   在 `packages/core/src/types.ts` 中更新：

   - `ToolName`
   - `McpToolName`
   - 如有需要，新增 Tool 输出类型

   参数必须能用 JSON Schema 描述，不要只写自由文本。

2. 实现 Tool

   在 `packages/core/src/tools.ts` 的 `toolRegistry` 中新增 ToolDefinition：

   ```ts
   new_tool: {
     name: "new_tool",
     mcpName: "query_new_tool",
     description: "用中文说明工具能力。",
     inputSchema: objectSchema({ ... }, ["requiredField"]),
     execute: async (input, context) => {
       ...
     }
   }
   ```

   返回值必须是标准 ToolResult：

   ```ts
   {
     success,
     data,
     error,
     source,
     latencyMs,
     timestamp
   }
   ```

3. 注册到 MCP Server

   在 `packages/mcp-server/src/index.ts` 中使用官方 MCP SDK：

   ```ts
   server.registerTool(
     "query_new_tool",
     {
       title: "Query New Tool",
       description: "用中文说明 MCP 工具能力。",
       inputSchema: {
         serviceId: z.string(),
         context: z.object({
           incidentId: z.string().optional(),
           serviceId: z.string().optional()
         }).optional()
       }
     },
     async ({ serviceId, context }) =>
       call("new_tool", { serviceId }, { serviceId, context })
   );
   ```

4. 确认 Agent 可调用

   如果该 Tool 应被动态 Agent 使用，需要更新 `packages/core/src/deepseek.ts` 的系统提示词，加入新的可用工具名。

   如果没有真实 LLM Key，本地 fallback planner 可以只作为演示兜底，不要写死正式诊断顺序。

5. 增加测试或验证

   至少运行：

   ```bash
   npm run check
   npm run mcp:verify
   npm run cli -- diagnose inc-20260824-001
   ```

   如果 Tool 需要被 `mcp:verify` 覆盖，在 `packages/mcp-server/src/verify.ts` 增加一个最小 callTool 示例。

6. 更新 README

   README 必须用中文同步说明：

   - 新 Tool 的用途
   - MCP Server 暴露的工具名
   - Agent 何时会调用它
   - Demo Case 中是否需要展示它

7. 提交

   提交信息使用中文，例如：

   ```bash
   git commit -m "新增服务容量分析 MCP 工具"
   ```

## 禁止事项

- 不要把 Tool 做成绕过 MCP 的正式诊断路径。
- 不要自动执行高风险修复动作。
- 不要提交 `.env`、密码、Token、API Key。
- 不要为了一个 Tool 引入新的大型技术栈。
