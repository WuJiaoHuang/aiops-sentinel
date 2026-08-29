import { requestDeepSeekDiagnosis } from "./deepseek";
import { getIncident, tools } from "./tools";
import type { AgentStep, DiagnosisTask, EvidenceItem } from "./types";

export type LocalAgentConfig = {
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
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

  const context = { incidentId, serviceId: incident.serviceId };
  const incidentSummary = tools.incident_summary({ incidentId }, context);
  const metricResult = tools.metric_query({ serviceId: incident.serviceId }, context);
  const logResult = tools.log_search({ serviceId: incident.serviceId, level: "error" }, context);
  const traceResult = tools.dependency_trace({ serviceId: incident.serviceId }, context);
  const knowledgeResult = tools.knowledge_search({ serviceId: incident.serviceId, query: incident.title }, context);
  const latestMetric = metricResult.result.at(-1);
  const rollbackResult = tools.rollback_advisor({ incidentId, errorRate: latestMetric?.errorRate ?? 0 }, context);
  const steps: AgentStep[] = [
    {
      id: "step-local-planner",
      title: "生成本地诊断计划",
      description: "前端 fallback 使用本地工具执行离线诊断，后端正式流程使用 MCP Agent。",
      tool: "agent_planner",
      status: "completed",
      durationMs: 4,
      summary: "本地调用 incident_summary -> metric_query -> log_search -> dependency_trace -> knowledge_search"
    },
    {
      id: "step-incident-summary",
      title: "读取故障上下文",
      description: "根据故障 ID 获取告警标题、影响服务、严重等级和业务摘要。",
      tool: incidentSummary.metadata.tool,
      status: "completed",
      durationMs: incidentSummary.metadata.durationMs,
      summary: incident.summary
    },
    {
      id: "step-metric-query",
      title: "分析指标窗口",
      description: "读取接口延迟、错误率、CPU、内存等指标，判断异常是否持续扩大。",
      tool: metricResult.metadata.tool,
      status: "completed",
      durationMs: metricResult.metadata.durationMs,
      summary: latestMetric ? `最新错误率 ${latestMetric.errorRate}%，延迟 ${latestMetric.latencyMs}ms` : "暂无可用指标"
    },
    {
      id: "step-log-search",
      title: "检索异常日志",
      description: "查询受影响服务近期 error 日志，寻找超时、重试、依赖异常等信号。",
      tool: logResult.metadata.tool,
      status: "completed",
      durationMs: logResult.metadata.durationMs,
      summary: `命中 ${logResult.result.length} 条 error 日志`
    },
    {
      id: "step-dependency-trace",
      title: "追踪服务依赖",
      description: "检查当前服务依赖链，判断故障是否可能由上游或基础设施扩散。",
      tool: traceResult.metadata.tool,
      status: "completed",
      durationMs: traceResult.metadata.durationMs,
      summary: `发现 ${traceResult.result.dependencies.length} 个依赖服务`
    },
    {
      id: "step-knowledge-search",
      title: "检索处置知识",
      description: "检索 Runbook 和历史处置知识，提供本地 RAG 证据。",
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
