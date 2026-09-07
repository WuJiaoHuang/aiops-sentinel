import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { incidents, logs, metrics, services } from "./mockData";
import { getTargetConfig } from "./providers/targets/TargetConfigLoader";
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
  service?: Service | { id: string; name: string; runtime?: string };
  dependencies: Array<Service | { name: string; type: "service" | "infrastructure" }>;
  provider?: "target-config" | "mock";
  target?: string;
};

export type KnowledgeResult = {
  id: string;
  title: string;
  path: string;
  score: number;
  snippet: string;
  serviceId?: string;
  content?: string;
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

const serviceOf = (input: Record<string, unknown>) => String(input.service ?? input.serviceId ?? "svc-order");

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

const infrastructureNames = new Set(["mysql", "redis", "kafka", "zookeeper", "prometheus", "grafana", "database", "db"]);

const dependencyTypeOf = (name: string): "service" | "infrastructure" =>
  infrastructureNames.has(name.toLowerCase()) ? "infrastructure" : "service";

const runbookDir = () => path.resolve(process.cwd(), "docs", "runbooks");

const tokenize = (...values: Array<string | undefined>) =>
  values
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5_-]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

const readRunbooks = (): KnowledgeResult[] => {
  const directory = runbookDir();
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const fullPath = path.join(directory, file);
      const content = readFileSync(fullPath, "utf8");
      const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file.replace(/\.md$/, "");
      return {
        id: file.replace(/\.md$/, ""),
        title,
        path: path.relative(process.cwd(), fullPath).replace(/\\/g, "/"),
        score: 0,
        snippet: content.replace(/\s+/g, " ").slice(0, 220),
        content
      };
    });
};

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
        target: { type: "string", description: "目标系统 ID，例如 cityeats 或 demo-service" },
        service: { type: "string", description: "目标系统内的服务名，例如 cityeats" },
        serviceId: { type: "string", description: "兼容旧 Demo 的服务 ID，例如 svc-order" },
        level: { type: "string", enum: ["error", "warn", "info"], description: "可选日志级别" }
      },
      []
    ),
    execute: async (input: Record<string, unknown>) => {
      const startedAt = Date.now();
      const serviceId = serviceOf(input);
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
        target: { type: "string", description: "目标系统 ID，例如 cityeats 或 demo-service" },
        service: { type: "string", description: "目标系统内的服务名，例如 cityeats" },
        serviceId: { type: "string", description: "兼容旧 Demo 的服务 ID，例如 svc-order" },
        metric: { type: "string", description: "逻辑指标名，例如 http_error_rate、http_latency、db_pool_pending" },
        timeRangeMinutes: { type: "number", description: "查询最近多少分钟的数据" }
      },
      []
    ),
    execute: async (input: Record<string, unknown>) => {
      const startedAt = Date.now();
      return withToolResult<MetricPoint[]>(() => metrics[serviceOf(input)] ?? [], startedAt);
    }
  },

  dependency_trace: {
    name: "dependency_trace",
    mcpName: "query_dependency",
    description: "分析服务上下游依赖，定位故障是否来自依赖扩散。",
    inputSchema: objectSchema(
      {
        target: { type: "string", description: "目标系统 ID，例如 nexus-commerce 或 demo-service" },
        service: { type: "string", description: "目标系统内服务名，例如 order-service" },
        serviceId: { type: "string", description: "服务 ID，例如 svc-order" }
      },
      []
    ),
    execute: async (input: Record<string, unknown>) => {
      const startedAt = Date.now();
      const targetName = String(input.target ?? process.env.TARGET_SERVICE_NAME ?? "demo-service");
      const serviceId = serviceOf(input);
      return withToolResult<DependencyTraceResult>(() => {
        const target = getTargetConfig(targetName);
        const serviceMetadata = target.services[serviceId];

        if (serviceMetadata) {
          return {
            provider: "target-config",
            target: target.name,
            service: {
              id: serviceId,
              name: serviceId,
              runtime: serviceMetadata.framework
            },
            dependencies: serviceMetadata.dependencies.map((name) => ({
              name,
              type: dependencyTypeOf(name)
            }))
          };
        }

        const service = services.find((item) => item.id === serviceId);
        const dependencies = service?.dependencies
          .map((dependencyId) => services.find((item) => item.id === dependencyId))
          .filter(Boolean) as Service[];

        return {
          provider: "mock",
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
        target: { type: "string", description: "目标系统 ID，例如 nexus-commerce 或 demo-service" },
        service: { type: "string", description: "目标系统内服务名，例如 order-service" },
        serviceId: { type: "string", description: "服务 ID，例如 svc-order" },
        query: { type: "string", description: "检索词，可以使用故障标题、当前假设或日志关键字" },
        keyword: { type: "string", description: "可选关键词，例如 timeout、fallback" }
      },
      []
    ),
    execute: async (input: Record<string, unknown>) => {
      const startedAt = Date.now();
      return withToolResult<KnowledgeResult[]>(
        () => {
          const serviceId = serviceOf(input);
          const query = typeof input.query === "string" ? input.query : "";
          const keyword = typeof input.keyword === "string" ? input.keyword : "";
          const terms = tokenize(serviceId, query, keyword);
          const uniqueTerms = [...new Set(terms)];

          return readRunbooks()
            .map((item) => {
              const haystack = `${item.title} ${item.content ?? ""}`.toLowerCase();
              const score = uniqueTerms.reduce((total, term) => total + (haystack.includes(term.toLowerCase()) ? 1 : 0), 0);
              return {
                ...item,
                score,
                content: undefined
              };
            })
            .filter((item) => item.score > 0 || uniqueTerms.length === 0)
            .sort((left, right) => right.score - left.score)
            .slice(0, 5);
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
        target: { type: "string", description: "目标系统 ID，例如 cityeats 或 demo-service" },
        service: { type: "string", description: "目标系统内的服务名，例如 cityeats" },
        serviceId: { type: "string", description: "兼容旧 Demo 的服务 ID，例如 svc-order" }
      },
      []
    ),
    execute: async (input: Record<string, unknown>) => {
      const startedAt = Date.now();
      const serviceId = serviceOf(input);
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
