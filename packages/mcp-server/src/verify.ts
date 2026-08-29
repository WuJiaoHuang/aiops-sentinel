import { createMcpToolRuntime } from "@aiops-sentinel/core/mcp-client";
import type { LogQueryResult } from "@aiops-sentinel/core";

const runtime = await createMcpToolRuntime();

try {
  const availableTools = await runtime.listTools();
  const logSearchResult = await runtime.callTool<LogQueryResult>(
    "log_search",
    {
      target: "demo-service",
      serviceId: "svc-order",
      level: "error"
    },
    {
      incidentId: "inc-20260824-001",
      serviceId: "svc-order"
    }
  );

  console.log(
    JSON.stringify(
      {
        transport: "stdio",
        server: "aiops-sentinel-mcp-server",
        availableTools,
        sampleCall: {
          tool: "query_logs",
          success: logSearchResult.success,
          source: logSearchResult.source,
          provider: logSearchResult.provider,
          latencyMs: logSearchResult.latencyMs,
          resultCount: logSearchResult.data?.entries.length ?? 0,
          firstTraceId: logSearchResult.data?.entries[0]?.traceId
        }
      },
      null,
      2
    )
  );
} finally {
  await runtime.close();
}
