import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getIncident, toolCatalog, tools } from "@aiops-sentinel/core";
import type { LogEntry, ToolContext, ToolResult } from "@aiops-sentinel/core";

const asMcpResult = <T>(toolResult: ToolResult<T>) => ({
  structuredContent: toolResult as unknown as Record<string, unknown>,
  content: [
    {
      type: "text" as const,
      text: JSON.stringify(toolResult, null, 2)
    }
  ]
});

const contextFrom = (input: { incidentId?: string; serviceId?: string }): ToolContext => {
  const incident = input.incidentId ? getIncident(input.incidentId) : undefined;

  return {
    incidentId: input.incidentId,
    serviceId: input.serviceId ?? incident?.serviceId
  };
};

const server = new McpServer({
  name: "aiops-sentinel-mcp-server",
  version: "0.1.0"
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
      incidentId: z.string().describe("故障 ID，例如 inc-20260824-001")
    }
  },
  async ({ incidentId }) => asMcpResult(tools.incident_summary({ incidentId }, contextFrom({ incidentId })))
);

server.registerTool(
  "metric_query",
  {
    title: "Metric Query",
    description: "读取服务延迟、错误率、CPU、内存等时间序列指标。",
    inputSchema: {
      serviceId: z.string().describe("服务 ID，例如 svc-order")
    }
  },
  async ({ serviceId }) => asMcpResult(tools.metric_query({ serviceId }, contextFrom({ serviceId })))
);

server.registerTool(
  "log_search",
  {
    title: "Log Search",
    description: "按服务和日志级别检索异常日志。",
    inputSchema: {
      serviceId: z.string().describe("服务 ID，例如 svc-order"),
      level: z.enum(["error", "warn", "info"]).optional().describe("可选日志级别")
    }
  },
  async ({ serviceId, level }) =>
    asMcpResult(tools.log_search({ serviceId, level: level as LogEntry["level"] | undefined }, contextFrom({ serviceId })))
);

server.registerTool(
  "dependency_trace",
  {
    title: "Dependency Trace",
    description: "查询服务依赖链，判断故障是否来自上下游扩散。",
    inputSchema: {
      serviceId: z.string().describe("服务 ID，例如 svc-order")
    }
  },
  async ({ serviceId }) => asMcpResult(tools.dependency_trace({ serviceId }, contextFrom({ serviceId })))
);

server.registerTool(
  "knowledge_search",
  {
    title: "Knowledge Search",
    description: "检索 Runbook 和历史处置知识，为诊断提供 RAG 证据。",
    inputSchema: {
      serviceId: z.string().describe("服务 ID，例如 svc-order"),
      query: z.string().optional().describe("检索词，可以使用故障标题")
    }
  },
  async ({ serviceId, query }) => asMcpResult(tools.knowledge_search({ serviceId, query }, contextFrom({ serviceId })))
);

server.registerTool(
  "rollback_advisor",
  {
    title: "Rollback Advisor",
    description: "根据错误率和故障上下文判断是否需要灰度回滚。",
    inputSchema: {
      incidentId: z.string().describe("故障 ID，例如 inc-20260824-001"),
      errorRate: z.number().describe("最新错误率百分比")
    }
  },
  async ({ incidentId, errorRate }) =>
    asMcpResult(tools.rollback_advisor({ incidentId, errorRate }, contextFrom({ incidentId })))
);

const transport = new StdioServerTransport();
await server.connect(transport);
