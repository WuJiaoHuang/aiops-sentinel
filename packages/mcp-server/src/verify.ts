import { createMcpToolRuntime } from "@aiops-sentinel/core/mcp-client";
import type { LogEntry } from "@aiops-sentinel/core";

const runtime = await createMcpToolRuntime();

try {
  const availableTools = await runtime.listTools();
  const logSearchResult = await runtime.callTool<LogEntry[]>(
    "log_search",
    {
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
          latencyMs: logSearchResult.latencyMs,
          resultCount: logSearchResult.data?.length ?? 0,
          firstTraceId: logSearchResult.data?.[0]?.traceId
        }
      },
      null,
      2
    )
  );
} finally {
  await runtime.close();
}
