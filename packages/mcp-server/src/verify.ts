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
          tool: "log_search",
          metadata: logSearchResult.metadata,
          resultCount: logSearchResult.result.length,
          firstTraceId: logSearchResult.result[0]?.traceId
        }
      },
      null,
      2
    )
  );
} finally {
  await runtime.close();
}
