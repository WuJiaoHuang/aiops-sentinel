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
      title: "Log anomalies",
      detail: logResult.result.map((log) => `${log.level}: ${log.message}`).join("; ") || "No recent log anomaly",
      confidence: 0.78
    },
    {
      source: metricResult.metadata.tool,
      title: "Metric window",
      detail: latestMetric
        ? `Latest latency ${latestMetric.latencyMs}ms, error rate ${latestMetric.errorRate}%, cpu ${latestMetric.cpu}%.`
        : "No metric window available.",
      confidence: 0.8
    },
    {
      source: traceResult.metadata.tool,
      title: "Dependency trace",
      detail: `Dependencies: ${traceResult.result.dependencies.map((service) => service.name).join(", ") || "none"}.`,
      confidence: 0.65
    },
    {
      source: rollbackResult.metadata.tool,
      title: "Rollback advisor",
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
