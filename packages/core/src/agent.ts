import { requestDeepSeekDiagnosis } from "./deepseek";
import { getIncident, tools } from "./tools";
import type { Diagnosis, EvidenceItem } from "./types";

export type AgentConfig = {
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
};

export const diagnoseIncident = async (incidentId: string, config: AgentConfig = {}): Promise<Diagnosis> => {
  const incident = getIncident(incidentId);

  if (!incident) {
    throw new Error(`Incident ${incidentId} was not found`);
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

  return requestDeepSeekDiagnosis(
    {
      apiKey: config.deepseekApiKey,
      baseUrl: config.deepseekBaseUrl,
      model: config.deepseekModel
    },
    incident,
    evidence
  );
};
