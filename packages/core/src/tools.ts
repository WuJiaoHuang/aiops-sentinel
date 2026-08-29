import { incidents, logs, metrics, services } from "./mockData";
import type {
  Incident,
  LogEntry,
  MetricPoint,
  Service,
  ToolContext,
  ToolDefinition,
  ToolName,
  ToolResult
} from "./types";

const runbookKnowledge = [
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

const timed = <T>(tool: ToolName, result: T): ToolResult<T> => ({
  result,
  metadata: {
    tool,
    durationMs: Math.floor(12 + Math.random() * 36),
    mock: true
  }
});

export const toolCatalog: ToolDefinition[] = [
  {
    name: "incident_summary",
    description: "读取告警标题、等级、状态、影响服务和业务摘要。",
    inputSchema: { incidentId: "string" },
    outputSignal: "incident_context"
  },
  {
    name: "log_search",
    description: "按服务和日志级别检索异常日志，发现超时、重试、连接池耗尽等信号。",
    inputSchema: { serviceId: "string", level: "error | warn | info | optional" },
    outputSignal: "runtime_error_signal"
  },
  {
    name: "metric_query",
    description: "读取延迟、错误率、CPU、内存等时间序列，判断异常窗口和持续性。",
    inputSchema: { serviceId: "string" },
    outputSignal: "sli_slo_signal"
  },
  {
    name: "dependency_trace",
    description: "分析服务上下游依赖，定位故障是否来自依赖扩散。",
    inputSchema: { serviceId: "string" },
    outputSignal: "dependency_signal"
  },
  {
    name: "knowledge_search",
    description: "检索运维 Runbook 和历史处置知识，给 Agent 提供 RAG 证据。",
    inputSchema: { serviceId: "string", query: "string" },
    outputSignal: "rag_knowledge_signal"
  },
  {
    name: "rollback_advisor",
    description: "根据错误率和故障上下文判断是否需要灰度回滚。",
    inputSchema: { incidentId: "string", errorRate: "number" },
    outputSignal: "action_signal"
  }
];

export const listIncidents = () => incidents;

export const getIncident = (incidentId: string) => incidents.find((incident) => incident.id === incidentId);

export const tools = {
  log_search: (input: { serviceId: string; level?: LogEntry["level"] }, _context: ToolContext) => {
    const result = logs.filter((log) => {
      const matchService = log.serviceId === input.serviceId;
      const matchLevel = input.level ? log.level === input.level : true;
      return matchService && matchLevel;
    });

    return timed("log_search", result);
  },

  metric_query: (input: { serviceId: string }, _context: ToolContext) => {
    return timed<MetricPoint[]>("metric_query", metrics[input.serviceId] ?? []);
  },

  dependency_trace: (input: { serviceId: string }, _context: ToolContext) => {
    const service = services.find((item) => item.id === input.serviceId);
    const dependencies = service?.dependencies
      .map((dependencyId) => services.find((item) => item.id === dependencyId))
      .filter(Boolean) as Service[];

    return timed("dependency_trace", {
      service,
      dependencies: dependencies ?? []
    });
  },

  incident_summary: (input: { incidentId: string }, _context: ToolContext) => {
    const incident = getIncident(input.incidentId);
    return timed<Incident | undefined>("incident_summary", incident);
  },

  knowledge_search: (input: { serviceId: string; query?: string }, _context: ToolContext) => {
    const query = input.query?.toLowerCase() ?? "";
    const result = runbookKnowledge.filter((item) => {
      const matchService = item.serviceId === input.serviceId || item.serviceId === "global";
      const matchQuery = query ? `${item.title} ${item.content}`.toLowerCase().includes(query) : true;
      return matchService || matchQuery;
    });

    return timed("knowledge_search", result);
  },

  rollback_advisor: (input: { incidentId: string; errorRate: number }, _context: ToolContext) => {
    const shouldRollback = input.errorRate >= 10;

    return timed("rollback_advisor", {
      shouldRollback,
      advice: shouldRollback
        ? "错误率已超过回滚阈值，建议准备受控回滚，并保持支付链路降级策略。"
        : "暂不需要回滚，建议继续执行缓解措施，并观察后续两个指标窗口。"
    });
  }
};
