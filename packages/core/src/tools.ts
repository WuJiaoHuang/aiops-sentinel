import { incidents, logs, metrics, services } from "./mockData";
import type {
  Incident,
  JsonSchema,
  LogEntry,
  MetricPoint,
  Service,
  ToolContext,
  ToolDefinition,
  ToolName,
  ToolResult
} from "./types";

export type DependencyTraceResult = {
  service?: Service;
  dependencies: Service[];
};

export type KnowledgeResult = {
  id: string;
  serviceId: string;
  title: string;
  content: string;
};

export type ServiceHealthResult = {
  serviceId: string;
  status: "healthy" | "degraded" | "critical" | "unknown";
  signals: string[];
  latestMetric?: MetricPoint;
};

export type RollbackAdvisorResult = {
  shouldRollback: boolean;
  advice: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  requiresApproval: boolean;
};

const runbookKnowledge: KnowledgeResult[] = [
  {
    id: "kb-payment-timeout",
    serviceId: "svc-order",
    title: "订单链路超时排查 Runbook",
    content: "优先检查 payment-service、库存服务和数据库连接池；若错误率超过 10%，开启降级并准备回滚。"
  },
  {
    id: "kb-cache-breakdown",
    serviceId: "svc-inventory",
    title: "缓存击穿与热点 Key 处置",
    content: "观察 Redis QPS、命中率和数据库回源；必要时启用互斥锁、热点 Key 预热和限流。"
  },
  {
    id: "kb-release-risk",
    serviceId: "global",
    title: "发布风险判断规则",
    content: "发布后一小时内错误率、P99 延迟和依赖异常同时上升时，应把新版本变更纳入根因候选。"
  }
];

const objectSchema = (
  properties: JsonSchema["properties"],
  required: string[] = []
): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
});

const ok = <T>(data: T, startedAt: number, source: ToolResult["source"] = "mock"): ToolResult<T> => ({
  success: true,
  data,
  error: null,
  source,
  latencyMs: Date.now() - startedAt,
  timestamp: new Date().toISOString()
});

const fail = <T>(error: string, startedAt: number, source: ToolResult["source"] = "mock"): ToolResult<T> => ({
  success: false,
  data: null,
  error,
  source,
  latencyMs: Date.now() - startedAt,
  timestamp: new Date().toISOString()
});

const withToolResult = async <T>(
  executor: () => T | Promise<T>,
  startedAt: number
): Promise<ToolResult<T>> => {
  try {
    return ok(await executor(), startedAt);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Tool 执行失败", startedAt);
  }
};

const latestMetricOf = (serviceId: string) => metrics[serviceId]?.at(-1);

export const listIncidents = () => incidents;

export const getIncident = (incidentId: string) => incidents.find((incident) => incident.id === incidentId);

export const toolRegistry = {
  incident_summary: {
    name: "incident_summary",
    mcpName: "incident_summary",
    description: "读取告警标题、等级、状态、影响服务和业务摘要。",
    inputSchema: objectSchema(
      {
        incidentId: { type: "string", description: "故障 ID，例如 inc-20260824-001" }
      },
      ["incidentId"]
    ),
    execute: async (input: Record<string, unknown>) => {
      const startedAt = Date.now();
      return withToolResult<Incident | undefined>(() => getIncident(String(input.incidentId)), startedAt);
    }
  },

  log_search: {
    name: "log_search",
    mcpName: "query_logs",
    description: "按服务和日志级别检索异常日志，发现超时、重试、连接池耗尽等信号。",
    inputSchema: objectSchema(
      {
        serviceId: { type: "string", description: "服务 ID，例如 svc-order" },
        level: { type: "string", enum: ["error", "warn", "info"], description: "可选日志级别" }
      },
      ["serviceId"]
    ),
    execute: async (input: Record<string, unknown>) => {
      const startedAt = Date.now();
      const serviceId = String(input.serviceId);
      const level = input.level as LogEntry["level"] | undefined;
      return withToolResult<LogEntry[]>(
        () =>
          logs.filter((log) => {
            const matchService = log.serviceId === serviceId;
            const matchLevel = level ? log.level === level : true;
            return matchService && matchLevel;
          }),
        startedAt
      );
    }
  },

  metric_query: {
    name: "metric_query",
    mcpName: "query_metrics",
    description: "读取延迟、错误率、CPU、内存等时间序列，判断异常窗口和持续性。",
    inputSchema: objectSchema(
      {
        serviceId: { type: "string", description: "服务 ID，例如 svc-order" }
      },
      ["serviceId"]
    ),
    execute: async (input: Record<string, unknown>) => {
      const startedAt = Date.now();
      return withToolResult<MetricPoint[]>(() => metrics[String(input.serviceId)] ?? [], startedAt);
    }
  },

  dependency_trace: {
    name: "dependency_trace",
    mcpName: "query_dependency",
    description: "分析服务上下游依赖，定位故障是否来自依赖扩散。",
    inputSchema: objectSchema(
      {
        serviceId: { type: "string", description: "服务 ID，例如 svc-order" }
      },
      ["serviceId"]
    ),
    execute: async (input: Record<string, unknown>) => {
      const startedAt = Date.now();
      const serviceId = String(input.serviceId);
      return withToolResult<DependencyTraceResult>(() => {
        const service = services.find((item) => item.id === serviceId);
        const dependencies = service?.dependencies
          .map((dependencyId) => services.find((item) => item.id === dependencyId))
          .filter(Boolean) as Service[];

        return {
          service,
          dependencies: dependencies ?? []
        };
      }, startedAt);
    }
  },

  knowledge_search: {
    name: "knowledge_search",
    mcpName: "search_knowledge",
    description: "检索运维 Runbook 和历史处置知识，给 Agent 提供 RAG 证据。",
    inputSchema: objectSchema(
      {
        serviceId: { type: "string", description: "服务 ID，例如 svc-order" },
        query: { type: "string", description: "检索词，可以使用故障标题或当前假设" }
      },
      ["serviceId"]
    ),
    execute: async (input: Record<string, unknown>) => {
      const startedAt = Date.now();
      return withToolResult<KnowledgeResult[]>(
        () => {
          const serviceId = String(input.serviceId);
          const query = typeof input.query === "string" ? input.query.toLowerCase() : "";
          return runbookKnowledge.filter((item) => {
            const matchService = item.serviceId === serviceId || item.serviceId === "global";
            const matchQuery = query ? `${item.title} ${item.content}`.toLowerCase().includes(query) : true;
            return matchService || matchQuery;
          });
        },
        startedAt
      );
    }
  },

  service_health: {
    name: "service_health",
    mcpName: "get_service_health",
    description: "聚合服务最新错误率、延迟和资源水位，给出健康状态摘要。",
    inputSchema: objectSchema(
      {
        serviceId: { type: "string", description: "服务 ID，例如 svc-order" }
      },
      ["serviceId"]
    ),
    execute: async (input: Record<string, unknown>) => {
      const startedAt = Date.now();
      const serviceId = String(input.serviceId);
      return withToolResult<ServiceHealthResult>(() => {
        const latestMetric = latestMetricOf(serviceId);

        if (!latestMetric) {
          return {
            serviceId,
            status: "unknown",
            signals: ["没有可用指标窗口"]
          };
        }

        const signals = [
          `P99 latency ${latestMetric.latencyMs}ms`,
          `error rate ${latestMetric.errorRate}%`,
          `cpu ${latestMetric.cpu}%`,
          `memory ${latestMetric.memory}%`
        ];
        const status =
          latestMetric.errorRate >= 10 || latestMetric.latencyMs >= 900
            ? "critical"
            : latestMetric.errorRate >= 4 || latestMetric.latencyMs >= 600
              ? "degraded"
              : "healthy";

        return {
          serviceId,
          status,
          signals,
          latestMetric
        };
      }, startedAt);
    }
  },

  rollback_advisor: {
    name: "rollback_advisor",
    mcpName: "rollback_advisor",
    description: "根据错误率和故障上下文生成回滚建议，只输出 ActionProposal，不执行回滚。",
    inputSchema: objectSchema(
      {
        incidentId: { type: "string", description: "故障 ID，例如 inc-20260824-001" },
        errorRate: { type: "number", description: "最新错误率百分比" }
      },
      ["incidentId", "errorRate"]
    ),
    execute: async (input: Record<string, unknown>, _context: ToolContext) => {
      const startedAt = Date.now();
      return withToolResult<RollbackAdvisorResult>(() => {
        const shouldRollback = Number(input.errorRate ?? 0) >= 10;
        return {
          shouldRollback,
          riskLevel: shouldRollback ? "HIGH" : "LOW",
          requiresApproval: shouldRollback,
          advice: shouldRollback
            ? "错误率已超过回滚阈值，只能生成回滚建议；执行前必须由值班负责人确认。"
            : "暂不需要回滚，建议继续执行缓解措施，并观察后续两个指标窗口。"
        };
      }, startedAt);
    }
  }
} satisfies Record<ToolName, ToolDefinition>;

export const toolCatalog = Object.values(toolRegistry).map(({ execute: _execute, ...definition }) => definition);

export const getToolDefinition = (toolName: ToolName) => toolRegistry[toolName];

export const executeRegisteredTool = async (
  toolName: ToolName,
  input: Record<string, unknown>,
  context: ToolContext
) => {
  const tool = toolRegistry[toolName];

  if (!tool) {
    return fail(`Tool ${toolName} 不存在`, Date.now());
  }

  return tool.execute(input, context);
};

export const tools = toolRegistry;
