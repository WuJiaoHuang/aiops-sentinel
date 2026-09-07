import { buildMockDiagnosis } from "./deepseek";
import { incidents, logs, metrics, services } from "./mockData";
import type { AgentRun, AgentStep, DiagnosisTask, EvidenceItem, MetricPoint, ToolName, ToolResult } from "./types";

export type LocalAgentConfig = {
  maxSteps?: number;
};

const now = () => new Date().toISOString();

const getIncident = (incidentId: string) => incidents.find((incident) => incident.id === incidentId);

const toolDescriptions: Record<ToolName, string> = {
  incident_summary: "读取告警标题、等级、状态、影响服务和业务摘要。",
  log_search: "按服务和日志级别检索异常日志。",
  metric_query: "读取延迟、错误率、CPU、内存等时间序列。",
  dependency_trace: "分析服务上下游依赖。",
  knowledge_search: "检索运维 Runbook 和历史处置知识。",
  rollback_advisor: "根据错误率和故障上下文生成高风险动作建议。",
  service_health: "聚合服务最新错误率、延迟和资源水位。"
};

const localToolResult = (toolName: ToolName, input: Record<string, unknown>): ToolResult => {
  const startedAt = Date.now();
  const serviceId = String(input.serviceId ?? "svc-order");
  const ok = (data: unknown): ToolResult => ({
    success: true,
    data,
    error: null,
    source: "mock",
    latencyMs: Date.now() - startedAt,
    timestamp: now()
  });

  if (toolName === "incident_summary") {
    return ok(getIncident(String(input.incidentId)));
  }

  if (toolName === "metric_query") {
    return ok(metrics[serviceId] ?? []);
  }

  if (toolName === "log_search") {
    return ok(logs.filter((log) => log.serviceId === serviceId));
  }

  if (toolName === "dependency_trace") {
    const service = services.find((item) => item.id === serviceId);
    return ok({
      service,
      dependencies: service?.dependencies.map((id) => services.find((item) => item.id === id)).filter(Boolean) ?? []
    });
  }

  if (toolName === "rollback_advisor") {
    return ok({
      shouldRollback: true,
      advice: "错误率超过阈值，只生成建议，不自动执行。",
      riskLevel: "HIGH",
      requiresApproval: true
    });
  }

  if (toolName === "service_health") {
    const latest = metrics[serviceId]?.at(-1);
    return ok({
      serviceId,
      status: latest && latest.errorRate >= 10 ? "critical" : "healthy",
      signals: latest ? [`error rate ${latest.errorRate}%`, `latency ${latest.latencyMs}ms`] : ["没有可用指标窗口"]
    });
  }

  return ok([{ title: "本地演示 Runbook", content: "浏览器离线模式使用 mockData 展示诊断链路。" }]);
};

const summarize = (toolName: ToolName, result: ToolResult) => {
  if (!result.success) {
    return result.error ?? `${toolName} 调用失败`;
  }

  if (toolName === "metric_query") {
    const latest = ((result.data ?? []) as MetricPoint[]).at(-1);
    return latest ? `最新延迟 ${latest.latencyMs}ms，错误率 ${latest.errorRate}%` : "暂无指标数据";
  }

  if (Array.isArray(result.data)) {
    return `返回 ${result.data.length} 条结果`;
  }

  return JSON.stringify(result.data);
};

const evidenceFrom = (toolName: ToolName, result: ToolResult): EvidenceItem => ({
  source: toolName,
  title: toolDescriptions[toolName],
  detail: summarize(toolName, result),
  confidence: result.success ? 0.62 : 0.2
});

const nextLocalTool = (called: Set<ToolName>, severity: string): ToolName | null => {
  const candidates: ToolName[] =
    severity === "critical"
      ? ["incident_summary", "service_health", "metric_query", "log_search", "dependency_trace", "knowledge_search", "rollback_advisor"]
      : ["incident_summary", "service_health", "knowledge_search", "metric_query", "log_search"];

  return candidates.find((toolName) => !called.has(toolName)) ?? null;
};

export const diagnoseIncidentLocal = async (
  incidentId: string,
  config: LocalAgentConfig = {}
): Promise<DiagnosisTask> => {
  const startedAt = new Date();
  const incident = getIncident(incidentId);

  if (!incident) {
    throw new Error(`未找到故障 ${incidentId}`);
  }

  const steps: AgentStep[] = [];
  const evidence: EvidenceItem[] = [];
  const called = new Set<ToolName>();
  const maxSteps = config.maxSteps ?? 5;

  for (let index = 0; index < maxSteps; index += 1) {
    const toolName = nextLocalTool(called, incident.severity);

    if (!toolName) {
      break;
    }

    const toolInput =
      toolName === "incident_summary"
        ? { incidentId }
        : toolName === "rollback_advisor"
          ? { incidentId, errorRate: 12 }
          : { serviceId: incident.serviceId, ...(toolName === "log_search" ? { level: "error" } : {}) };
    const result = localToolResult(toolName, toolInput);
    called.add(toolName);
    evidence.push(evidenceFrom(toolName, result));
    steps.push({
      id: `local-step-${index + 1}`,
      stepIndex: index + 1,
      type: result.success ? "TOOL" : "ERROR",
      title: `本地 fallback 调用 ${toolName}`,
      description: toolDescriptions[toolName],
      toolName,
      toolInput,
      toolOutput: result,
      status: result.success ? "completed" : "failed",
      latency: result.latencyMs,
      timestamp: now(),
      summary: summarize(toolName, result)
    });
  }

  const diagnosis = buildMockDiagnosis(incident, evidence, evidence.length < 2, "mock");
  steps.push({
    id: `local-step-final`,
    stepIndex: steps.length + 1,
    type: "FINAL",
    title: diagnosis.uncertain ? "输出不确定诊断" : "生成本地诊断",
    description: "浏览器离线 fallback 基于已有证据生成演示结果；正式诊断请使用后端 MCP Agent。",
    toolName: "agent_runtime",
    toolOutput: diagnosis,
    status: "completed",
    latency: 0,
    timestamp: now(),
    summary: diagnosis.rootCause
  });

  const completedAt = new Date();
  const totalDurationMs = completedAt.getTime() - startedAt.getTime();
  const agentRun: AgentRun = {
    runId: `local-run-${incidentId}-${startedAt.getTime()}`,
    incidentId,
    model: "local-fallback",
    status: "completed",
    startTime: startedAt.toISOString(),
    endTime: completedAt.toISOString(),
    totalLatency: totalDurationMs,
    totalToolCalls: called.size,
    finalDiagnosis: diagnosis,
    confidence: diagnosis.confidence,
    steps,
    modelSource: "mock",
    fallbackUsed: false
  };

  return {
    id: `task-${incidentId}-${startedAt.getTime()}`,
    incidentId,
    status: "COMPLETED",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    totalDurationMs,
    steps,
    diagnosis,
    agentRun
  };
};
