import { buildMockDiagnosis } from "./deepseek";
import { getIncident, getToolDefinition, toolRegistry } from "./tools";
import type { AgentRun, AgentStep, DiagnosisTask, EvidenceItem, MetricPoint, ToolName, ToolResult } from "./types";

export type LocalAgentConfig = {
  maxSteps?: number;
};

const now = () => new Date().toISOString();

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
  title: getToolDefinition(toolName).description,
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
    const toolDefinition = getToolDefinition(toolName);
    const result = await toolRegistry[toolName].execute(toolInput, { incidentId, serviceId: incident.serviceId });
    called.add(toolName);
    evidence.push(evidenceFrom(toolName, result));
    steps.push({
      id: `local-step-${index + 1}`,
      stepIndex: index + 1,
      type: result.success ? "TOOL" : "ERROR",
      title: `本地 fallback 调用 ${toolName}`,
      description: toolDefinition.description,
      toolName,
      toolInput,
      toolOutput: result,
      status: result.success ? "completed" : "failed",
      latency: result.latencyMs,
      timestamp: now(),
      summary: summarize(toolName, result)
    });
  }

  const diagnosis = buildMockDiagnosis(incident, evidence, evidence.length < 2);
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
    steps
  };

  return {
    id: `task-${incidentId}-${startedAt.getTime()}`,
    incidentId,
    status: "completed",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    totalDurationMs,
    steps,
    diagnosis,
    agentRun
  };
};
