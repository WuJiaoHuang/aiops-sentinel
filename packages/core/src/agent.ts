import { requestDeepSeekDiagnosis } from "./deepseek";
import { getIncident, tools } from "./tools";
import type { AgentStep, DiagnosisTask, EvidenceItem } from "./types";

export type AgentConfig = {
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
};

export const diagnoseIncident = async (incidentId: string, config: AgentConfig = {}): Promise<DiagnosisTask> => {
  const startedAt = new Date();
  const incident = getIncident(incidentId);

  if (!incident) {
    throw new Error(`未找到故障 ${incidentId}`);
  }

  const context = { incidentId, serviceId: incident.serviceId };
  const incidentSummary = tools.incident_summary({ incidentId }, context);
  const logResult = tools.log_search({ serviceId: incident.serviceId }, context);
  const metricResult = tools.metric_query({ serviceId: incident.serviceId }, context);
  const traceResult = tools.dependency_trace({ serviceId: incident.serviceId }, context);
  const latestMetric = metricResult.result.at(-1);
  const rollbackResult = tools.rollback_advisor(
    { incidentId, errorRate: latestMetric?.errorRate ?? 0 },
    context
  );
  const steps: AgentStep[] = [
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
      id: "step-log-search",
      title: "检索异常日志",
      description: "查询受影响服务近期 error/warn 日志，寻找超时、重试、依赖异常等信号。",
      tool: logResult.metadata.tool,
      status: "completed",
      durationMs: logResult.metadata.durationMs,
      summary: `命中 ${logResult.result.length} 条相关日志`
    },
    {
      id: "step-metric-query",
      title: "分析指标窗口",
      description: "读取接口延迟、错误率、CPU、内存等指标，判断异常是否持续扩大。",
      tool: metricResult.metadata.tool,
      status: "completed",
      durationMs: metricResult.metadata.durationMs,
      summary: latestMetric
        ? `最新错误率 ${latestMetric.errorRate}%，延迟 ${latestMetric.latencyMs}ms`
        : "暂无可用指标"
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
    id: `task-${incidentId}`,
    incidentId,
    status: "completed",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    totalDurationMs: Math.max(completedAt.getTime() - startedAt.getTime(), toolDurationMs),
    steps,
    diagnosis
  };
};
