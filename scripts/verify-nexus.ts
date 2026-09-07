import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeProviderBackedTool } from "../packages/core/src/providerTools";
import { diagnoseIncident } from "../packages/core/src/agent";
import type { ToolContext } from "../packages/core/src/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultNexusRoot = path.resolve(repoRoot, "..", "Nexus_Commerce");

process.env.TARGET_SERVICE_NAME ??= "nexus-commerce";
process.env.METRICS_PROVIDER ??= "prometheus";
process.env.LOG_PROVIDER ??= "file";
process.env.HEALTH_PROVIDER ??= "springboot";
process.env.PROMETHEUS_BASE_URL ??= "http://localhost:9090";
process.env.NEXUS_COMMERCE_ROOT ||= defaultNexusRoot;
process.env.AIOPS_TOOL_TIMEOUT_MS ??= "5000";

const context: ToolContext = {
  incidentId: "inc-nexus-preview-degraded",
  serviceId: "order-service"
};

const callTool = (toolName: "service_health" | "metric_query" | "log_search", input: Record<string, unknown>) =>
  executeProviderBackedTool(toolName, input, context);

const health = await callTool("service_health", {
  target: "nexus-commerce",
  service: "product-service"
});

const metrics = await callTool("metric_query", {
  target: "nexus-commerce",
  service: "order-service",
  metric: "http_latency",
  timeRangeMinutes: 15
});

const logs = await callTool("log_search", {
  target: "nexus-commerce",
  service: "order-service",
  level: "warn",
  keyword: "product-service",
  limit: 20
});

const diagnosisTask = await diagnoseIncident("inc-nexus-preview-degraded", {
  maxSteps: 5,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
  deepseekModel: process.env.DEEPSEEK_MODEL
});

const checkpointEvidence = diagnosisTask.checkpoint?.state.evidence ?? [];
const runtimeEvidence = diagnosisTask.diagnosis?.evidence ?? checkpointEvidence;

const report = {
  environment: {
    target: process.env.TARGET_SERVICE_NAME,
    prometheusBaseUrl: process.env.PROMETHEUS_BASE_URL,
    nexusCommerceRoot: process.env.NEXUS_COMMERCE_ROOT
  },
  tools: {
    get_service_health: {
      success: health.success,
      provider: health.provider,
      status: (health.data as { health?: { status?: string } } | null)?.health?.status,
      error: health.error
    },
    query_metrics: {
      success: metrics.success,
      provider: metrics.provider,
      seriesCount: (metrics.data as { series?: unknown[] } | null)?.series?.length ?? 0,
      error: metrics.error
    },
    query_logs: {
      success: logs.success,
      provider: logs.provider,
      entriesCount: (logs.data as { entries?: unknown[] } | null)?.entries?.length ?? 0,
      error: logs.error
    }
  },
  agent: {
    status: diagnosisTask.status,
    modelSource: diagnosisTask.diagnosis?.modelSource ?? diagnosisTask.checkpoint?.modelSource,
    fallbackUsed: diagnosisTask.agentRun?.fallbackUsed ?? diagnosisTask.checkpoint?.fallbackUsed,
    pendingAction: diagnosisTask.pendingActionProposal
      ? {
          action: diagnosisTask.pendingActionProposal.action,
          riskLevel: diagnosisTask.pendingActionProposal.riskLevel,
          requiresApproval: diagnosisTask.pendingActionProposal.requiresApproval
        }
      : null,
    toolOrder: diagnosisTask.steps
      .filter((step) => step.type === "TOOL")
      .map((step) => step.toolName),
    diagnosis: diagnosisTask.diagnosis?.rootCause,
    evidence: runtimeEvidence.map((item) => ({
      source: item.source,
      detail: item.detail
    }))
  }
};

console.log(JSON.stringify(report, null, 2));

const healthStatus = (health.data as { health?: { status?: string } } | null)?.health?.status;

if (health.provider !== "springboot" || !["DOWN", "UNKNOWN"].includes(String(healthStatus))) {
  throw new Error("get_service_health did not return real springboot outage data");
}

if (!metrics.success || metrics.provider !== "prometheus") {
  throw new Error("query_metrics did not return real prometheus provider data");
}

if (!logs.success || logs.provider !== "file") {
  throw new Error("query_logs did not return real file provider data");
}

if (((metrics.data as { series?: unknown[] } | null)?.series?.length ?? 0) === 0) {
  throw new Error("query_metrics returned no Prometheus series");
}

if (((logs.data as { entries?: unknown[] } | null)?.entries?.length ?? 0) === 0) {
  throw new Error("query_logs returned no Nexus log entries");
}
