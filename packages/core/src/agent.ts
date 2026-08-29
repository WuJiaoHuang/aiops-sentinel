import { requestDeepSeekDiagnosis } from "./deepseek";
import { createMcpToolRuntime } from "./mcpClient";
import { getIncident, tools } from "./tools";
import type {
  AgentStep,
  DiagnosisTask,
  EvidenceItem,
  Incident,
  LogEntry,
  MetricPoint,
  Service,
  ToolName,
  ToolResult
} from "./types";

export type AgentConfig = {
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  useMcpTools?: boolean;
};

type PlannedToolCall = {
  tool: ToolName;
  title: string;
  reason: string;
  input: Record<string, unknown>;
};

type DependencyTraceResult = {
  service?: Service;
  dependencies: Service[];
};

type KnowledgeResult = {
  id: string;
  serviceId: string;
  title: string;
  content: string;
};

const planInvestigation = (incident: Incident): PlannedToolCall[] => {
  const basePlan: PlannedToolCall[] = [
    {
      tool: "incident_summary",
      title: "读取故障上下文",
      reason: "先确认告警等级、影响服务、业务摘要和故障状态，避免脱离上下文排查。",
      input: { incidentId: incident.id }
    },
    {
      tool: "metric_query",
      title: "分析指标窗口",
      reason: "判断 P99 延迟、错误率、CPU 和内存是否同时异常，形成 SLI 证据。",
      input: { serviceId: incident.serviceId }
    },
    {
      tool: "log_search",
      title: "检索异常日志",
      reason: "从 error 日志里提取超时、重试、依赖失败、连接池等直接错误信号。",
      input: { serviceId: incident.serviceId, level: "error" }
    },
    {
      tool: "dependency_trace",
      title: "追踪服务依赖",
      reason: "定位故障是否由下游服务、数据库、缓存或第三方依赖扩散。",
      input: { serviceId: incident.serviceId }
    },
    {
      tool: "knowledge_search",
      title: "检索处置知识",
      reason: "把 Runbook 和历史处置经验纳入诊断，补足 RAG 型证据。",
      input: { serviceId: incident.serviceId, query: incident.title }
    }
  ];

  if (incident.severity === "critical") {
    return basePlan;
  }

  return basePlan.filter((call) => call.tool !== "dependency_trace" || incident.status === "investigating");
};

export const diagnoseIncident = async (incidentId: string, config: AgentConfig = {}): Promise<DiagnosisTask> => {
  const startedAt = new Date();
  const incident = getIncident(incidentId);

  if (!incident) {
    throw new Error(`未找到故障 ${incidentId}`);
  }

  const context = { incidentId, serviceId: incident.serviceId };
  const plan = planInvestigation(incident);
  const useMcpTools = config.useMcpTools ?? true;
  const mcpRuntime = useMcpTools ? await createMcpToolRuntime() : null;
  const availableMcpTools = mcpRuntime ? await mcpRuntime.listTools() : [];
  const callTool = async <T>(tool: ToolName, input: Record<string, unknown>) => {
    if (mcpRuntime) {
      return mcpRuntime.callTool<T>(tool, input, context);
    }

    return tools[tool](input as never, context) as ToolResult<T>;
  };
  const incidentSummary = await callTool<Incident | undefined>("incident_summary", { incidentId });
  const metricResult = await callTool<MetricPoint[]>("metric_query", { serviceId: incident.serviceId });
  const logResult = await callTool<LogEntry[]>("log_search", { serviceId: incident.serviceId, level: "error" });
  const traceResult = await callTool<DependencyTraceResult>("dependency_trace", { serviceId: incident.serviceId });
  const knowledgeResult = await callTool<KnowledgeResult[]>("knowledge_search", {
    serviceId: incident.serviceId,
    query: incident.title
  });
  const latestMetric = metricResult.result.at(-1);
  const rollbackResult = await callTool<{ shouldRollback: boolean; advice: string }>("rollback_advisor", {
    incidentId,
    errorRate: latestMetric?.errorRate ?? 0
  });
  await mcpRuntime?.close();
  const steps: AgentStep[] = [
    {
      id: "step-agent-planner",
      title: "生成诊断计划",
      description: "Agent 通过 MCP listTools 读取工具能力，并根据故障等级、服务上下文选择本轮排查路径。",
      tool: "agent_planner",
      status: "completed",
      durationMs: 8,
      summary: useMcpTools
        ? `MCP tools: ${availableMcpTools.join(", ")}；计划调用 ${plan.map((call) => call.tool).join(" -> ")}`
        : `本地工具模式；计划调用 ${plan.map((call) => call.tool).join(" -> ")}`
    },
    {
      id: "step-incident-summary",
      title: plan.find((call) => call.tool === "incident_summary")?.title ?? "读取故障上下文",
      description: plan.find((call) => call.tool === "incident_summary")?.reason ?? "根据故障 ID 获取告警上下文。",
      tool: incidentSummary.metadata.tool,
      status: "completed",
      durationMs: incidentSummary.metadata.durationMs,
      summary: incident.summary
    },
    {
      id: "step-metric-query",
      title: plan.find((call) => call.tool === "metric_query")?.title ?? "分析指标窗口",
      description: plan.find((call) => call.tool === "metric_query")?.reason ?? "读取接口延迟、错误率等指标。",
      tool: metricResult.metadata.tool,
      status: "completed",
      durationMs: metricResult.metadata.durationMs,
      summary: latestMetric
        ? `最新错误率 ${latestMetric.errorRate}%，延迟 ${latestMetric.latencyMs}ms`
        : "暂无可用指标"
    },
    {
      id: "step-log-search",
      title: plan.find((call) => call.tool === "log_search")?.title ?? "检索异常日志",
      description: plan.find((call) => call.tool === "log_search")?.reason ?? "查询受影响服务近期日志。",
      tool: logResult.metadata.tool,
      status: "completed",
      durationMs: logResult.metadata.durationMs,
      summary: `命中 ${logResult.result.length} 条 error 日志`
    },
    {
      id: "step-dependency-trace",
      title: plan.find((call) => call.tool === "dependency_trace")?.title ?? "追踪服务依赖",
      description: plan.find((call) => call.tool === "dependency_trace")?.reason ?? "检查当前服务依赖链。",
      tool: traceResult.metadata.tool,
      status: "completed",
      durationMs: traceResult.metadata.durationMs,
      summary: `发现 ${traceResult.result.dependencies.length} 个依赖服务`
    },
    {
      id: "step-knowledge-search",
      title: plan.find((call) => call.tool === "knowledge_search")?.title ?? "检索处置知识",
      description: plan.find((call) => call.tool === "knowledge_search")?.reason ?? "检索 Runbook 和历史经验。",
      tool: knowledgeResult.metadata.tool,
      status: "completed",
      durationMs: knowledgeResult.metadata.durationMs,
      summary: `召回 ${knowledgeResult.result.length} 条处置知识`
    },
    {
      id: "step-rollback-advisor",
      title: "评估回滚风险",
      description: "结合错误率阈值和影响范围，判断是否需要执行灰度回滚。",
      tool: rollbackResult.metadata.tool,
      status: "completed",
      durationMs: rollbackResult.metadata.durationMs,
      summary: rollbackResult.result.advice
    }
  ];

  const evidence: EvidenceItem[] = [
    {
      source: incidentSummary.metadata.tool,
      title: incident.title,
      detail: incident.summary,
      confidence: 0.74
    },
    {
      source: logResult.metadata.tool,
      title: "日志异常",
      detail: logResult.result.map((log) => `${log.level}: ${log.message}`).join("；") || "暂无近期日志异常",
      confidence: 0.78
    },
    {
      source: metricResult.metadata.tool,
      title: "指标窗口",
      detail: latestMetric
        ? `最新延迟 ${latestMetric.latencyMs}ms，错误率 ${latestMetric.errorRate}%，CPU ${latestMetric.cpu}%。`
        : "暂无可用指标窗口。",
      confidence: 0.8
    },
    {
      source: traceResult.metadata.tool,
      title: "依赖链路",
      detail: `依赖服务：${traceResult.result.dependencies.map((service) => service.name).join("、") || "无"}。`,
      confidence: 0.65
    },
    {
      source: knowledgeResult.metadata.tool,
      title: "Runbook 知识",
      detail:
        knowledgeResult.result.map((item) => `${item.title}: ${item.content}`).join("；") ||
        "暂无匹配的处置知识。",
      confidence: 0.68
    },
    {
      source: rollbackResult.metadata.tool,
      title: "回滚建议",
      detail: rollbackResult.result.advice,
      confidence: rollbackResult.result.shouldRollback ? 0.82 : 0.58
    }
  ];

  const diagnosis = await requestDeepSeekDiagnosis(
    {
      apiKey: config.deepseekApiKey,
      baseUrl: config.deepseekBaseUrl,
      model: config.deepseekModel
    },
    incident,
    evidence
  );
  const completedAt = new Date();
  const toolDurationMs = steps.reduce((total, step) => total + step.durationMs, 0);

  return {
    id: `task-${incidentId}-${startedAt.getTime()}`,
    incidentId,
    status: "completed",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    totalDurationMs: Math.max(completedAt.getTime() - startedAt.getTime(), toolDurationMs),
    steps,
    diagnosis
  };
};
