import { incidents, logs, metrics, services } from "./mockData";
import type { Incident, LogEntry, MetricPoint, Service, ToolContext, ToolResult } from "./types";

const timed = <T>(tool: string, result: T): ToolResult<T> => ({
  result,
  metadata: {
    tool,
    durationMs: Math.floor(12 + Math.random() * 36),
    mock: true
  }
});

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
