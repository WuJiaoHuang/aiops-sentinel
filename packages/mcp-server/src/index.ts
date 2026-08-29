import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getIncident, toolCatalog } from "@aiops-sentinel/core";
import { executeProviderBackedTool } from "@aiops-sentinel/core/provider-tools";
import type { LogEntry, ToolContext, ToolName, ToolResult } from "@aiops-sentinel/core";

const asMcpResult = <T>(toolResult: ToolResult<T>) => ({
  structuredContent: toolResult as unknown as Record<string, unknown>,
  content: [
    {
      type: "text" as const,
      text: JSON.stringify(toolResult, null, 2)
    }
  ]
});

const contextFrom = (input: { incidentId?: string; serviceId?: string; context?: ToolContext }): ToolContext => {
  const incident = input.incidentId ? getIncident(input.incidentId) : undefined;

  return {
    incidentId: input.context?.incidentId ?? input.incidentId,
    serviceId: input.context?.serviceId ?? input.serviceId ?? incident?.serviceId
  };
};

const call = async <T>(
  toolName: ToolName,
  input: Record<string, unknown>,
  contextInput: { incidentId?: string; serviceId?: string; context?: ToolContext }
) => asMcpResult(await executeProviderBackedTool(toolName, input, contextFrom(contextInput)) as ToolResult<T>);

const server = new McpServer({
  name: "aiops-sentinel-mcp-server",
  version: "0.2.0"
});

server.registerResource(
  "aiops_tool_catalog",
  "aiops://tools/catalog",
  {
    title: "AIOps Sentinel MCP Tool Catalog",
    description: "AIOps Sentinel 可供 Agent 调用的 MCP 工具目录。",
    mimeType: "application/json"
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(toolCatalog, null, 2)
      }
    ]
  })
);

server.registerTool(
  "incident_summary",
  {
    title: "Incident Summary",
    description: "读取告警标题、等级、状态、影响服务和业务摘要。",
    inputSchema: {
      incidentId: z.string().describe("故障 ID，例如 inc-20260824-001"),
      context: z.object({ incidentId: z.string().optional(), serviceId: z.string().optional() }).optional()
    }
  },
  async ({ incidentId, context }) => call("incident_summary", { incidentId }, { incidentId, context })
);

server.registerTool(
  "query_metrics",
  {
    title: "Query Metrics",
    description: "读取服务延迟、错误率、CPU、内存等时间序列指标。",
    inputSchema: {
      target: z.string().optional().describe("目标系统 ID，例如 cityeats 或 demo-service"),
      service: z.string().optional().describe("目标系统内服务名，例如 cityeats"),
      serviceId: z.string().optional().describe("兼容旧 Demo 的服务 ID，例如 svc-order"),
      metric: z.string().optional().describe("逻辑指标名，例如 http_latency、http_error_rate、db_pool_pending"),
      timeRangeMinutes: z.number().optional().describe("查询最近多少分钟的数据"),
      context: z.object({ incidentId: z.string().optional(), serviceId: z.string().optional() }).optional()
    }
  },
  async ({ target, service, serviceId, metric, timeRangeMinutes, context }) =>
    call("metric_query", { target, service, serviceId, metric, timeRangeMinutes }, { serviceId, context })
);

server.registerTool(
  "query_logs",
  {
    title: "Query Logs",
    description: "按服务和日志级别检索异常日志。",
    inputSchema: {
      target: z.string().optional().describe("目标系统 ID，例如 cityeats 或 demo-service"),
      service: z.string().optional().describe("目标系统内服务名，例如 cityeats"),
      serviceId: z.string().optional().describe("兼容旧 Demo 的服务 ID，例如 svc-order"),
      level: z.enum(["error", "warn", "info"]).optional().describe("可选日志级别"),
      keyword: z.string().optional().describe("日志关键字"),
      startTime: z.string().optional().describe("开始时间 ISO 字符串"),
      endTime: z.string().optional().describe("结束时间 ISO 字符串"),
      limit: z.number().optional().describe("最大返回条数"),
      context: z.object({ incidentId: z.string().optional(), serviceId: z.string().optional() }).optional()
    }
  },
  async ({ target, service, serviceId, level, keyword, startTime, endTime, limit, context }) =>
    call<LogEntry[]>(
      "log_search",
      { target, service, serviceId, level: level as LogEntry["level"] | undefined, keyword, startTime, endTime, limit },
      { serviceId, context }
    )
);

server.registerTool(
  "query_dependency",
  {
    title: "Query Dependency",
    description: "查询服务依赖链，判断故障是否来自上下游扩散。",
    inputSchema: {
      serviceId: z.string().describe("服务 ID，例如 svc-order"),
      context: z.object({ incidentId: z.string().optional(), serviceId: z.string().optional() }).optional()
    }
  },
  async ({ serviceId, context }) => call("dependency_trace", { serviceId }, { serviceId, context })
);

server.registerTool(
  "get_service_health",
  {
    title: "Get Service Health",
    description: "聚合服务最新错误率、延迟和资源水位，给出健康状态摘要。",
    inputSchema: {
      target: z.string().optional().describe("目标系统 ID，例如 cityeats 或 demo-service"),
      service: z.string().optional().describe("目标系统内服务名，例如 cityeats"),
      serviceId: z.string().optional().describe("兼容旧 Demo 的服务 ID，例如 svc-order"),
      context: z.object({ incidentId: z.string().optional(), serviceId: z.string().optional() }).optional()
    }
  },
  async ({ target, service, serviceId, context }) =>
    call("service_health", { target, service, serviceId }, { serviceId, context })
);

server.registerTool(
  "search_knowledge",
  {
    title: "Search Knowledge",
    description: "检索 Runbook 和历史处置知识，为诊断提供 RAG 证据。",
    inputSchema: {
      serviceId: z.string().describe("服务 ID，例如 svc-order"),
      query: z.string().optional().describe("检索词，可以使用故障标题或当前假设"),
      context: z.object({ incidentId: z.string().optional(), serviceId: z.string().optional() }).optional()
    }
  },
  async ({ serviceId, query, context }) => call("knowledge_search", { serviceId, query }, { serviceId, context })
);

server.registerTool(
  "rollback_advisor",
  {
    title: "Rollback Advisor",
    description: "根据错误率和故障上下文生成回滚建议，只输出 ActionProposal，不执行回滚。",
    inputSchema: {
      incidentId: z.string().describe("故障 ID，例如 inc-20260824-001"),
      errorRate: z.number().describe("最新错误率百分比"),
      context: z.object({ incidentId: z.string().optional(), serviceId: z.string().optional() }).optional()
    }
  },
  async ({ incidentId, errorRate, context }) =>
    call("rollback_advisor", { incidentId, errorRate }, { incidentId, context })
);

const transport = new StdioServerTransport();
await server.connect(transport);
