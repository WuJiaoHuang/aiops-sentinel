import { createProvidersForTarget } from "./providers/ProviderFactory";
import type { HealthQueryResult, LogQueryResult, MetricQueryResult } from "./providers/types";
import { executeRegisteredTool } from "./tools";
import type { ToolContext, ToolName, ToolResult } from "./types";

const targetOf = (input: Record<string, unknown>) =>
  String(input.target ?? process.env.TARGET_SERVICE_NAME ?? "demo-service");

const serviceOf = (input: Record<string, unknown>) =>
  String(input.service ?? input.serviceId ?? process.env.TARGET_SERVICE_NAME ?? "svc-order");

const asToolResult = <T>(
  result: { success: boolean; provider: string; error?: string; latencyMs: number },
  data: T
): ToolResult<T> => ({
  success: result.success,
  data,
  error: result.error ?? null,
  source: result.provider === "mock" ? "mock" : "api",
  provider: result.provider,
  latencyMs: result.latencyMs,
  timestamp: new Date().toISOString()
});

export const executeProviderBackedTool = async (
  toolName: ToolName,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> => {
  if (toolName === "metric_query") {
    const target = targetOf(input);
    const service = serviceOf(input);
    const { metricsProvider } = createProvidersForTarget(target);
    const result = await metricsProvider.query({
      target,
      service,
      metric: typeof input.metric === "string" ? input.metric : "http_latency",
      timeRangeMinutes: input.timeRangeMinutes ? Number(input.timeRangeMinutes) : undefined
    });

    return asToolResult<MetricQueryResult>(result, result);
  }

  if (toolName === "log_search") {
    const target = targetOf(input);
    const service = serviceOf(input);
    const { logProvider } = createProvidersForTarget(target);
    const result = await logProvider.query({
      target,
      service,
      startTime: typeof input.startTime === "string" ? input.startTime : undefined,
      endTime: typeof input.endTime === "string" ? input.endTime : undefined,
      level: typeof input.level === "string" ? input.level : undefined,
      keyword: typeof input.keyword === "string" ? input.keyword : undefined,
      limit: input.limit ? Number(input.limit) : undefined
    });

    return asToolResult<LogQueryResult>(result, result);
  }

  if (toolName === "service_health") {
    const target = targetOf(input);
    const service = serviceOf(input);
    const { healthProvider } = createProvidersForTarget(target);
    const result = await healthProvider.getHealth({ target, service });

    return asToolResult<HealthQueryResult>(result, result);
  }

  return executeRegisteredTool(toolName, input, context);
};
