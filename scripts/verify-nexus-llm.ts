import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { diagnoseIncident, resumeDiagnosisFromCheckpoint } from "../packages/core/src/agent";
import { executeProviderBackedTool } from "../packages/core/src/providerTools";
import type { ApprovalDecision, DiagnosisTask, ToolContext, ToolName } from "../packages/core/src/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultNexusRoot = path.resolve(repoRoot, "..", "Nexus_Commerce");

dotenv.config({ path: path.join(repoRoot, ".env") });

if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error("DEEPSEEK_API_KEY is required in .env");
}

process.env.TARGET_SERVICE_NAME = "nexus-commerce";
process.env.METRICS_PROVIDER = "prometheus";
process.env.LOG_PROVIDER = "file";
process.env.HEALTH_PROVIDER = "springboot";
process.env.PROMETHEUS_BASE_URL ??= "http://localhost:9090";
process.env.NEXUS_COMMERCE_ROOT ||= defaultNexusRoot;
process.env.AIOPS_ALLOW_FALLBACK = "false";

const context: ToolContext = {
  incidentId: "inc-nexus-preview-degraded",
  serviceId: "order-service"
};

const precheckMetrics = await executeProviderBackedTool("metric_query", {
  target: "nexus-commerce",
  service: "order-service",
  metric: "http_qps",
  timeRangeMinutes: 15
}, context);
const precheckLogs = await executeProviderBackedTool("log_search", {
  target: "nexus-commerce",
  service: "order-service",
  level: "warn",
  keyword: "PRODUCT-SERVICE",
  limit: 20
}, context);
const precheckHealth = await executeProviderBackedTool("service_health", {
  target: "nexus-commerce",
  service: "product-service"
}, context);

if (!precheckMetrics.success || precheckMetrics.provider !== "prometheus") {
  throw new Error("Prometheus precheck failed");
}

if (((precheckMetrics.data as { series?: unknown[] } | null)?.series?.length ?? 0) === 0) {
  throw new Error("Prometheus precheck returned no HTTP series");
}

if (!precheckLogs.success || precheckLogs.provider !== "file") {
  throw new Error("File log precheck failed");
}

if (((precheckLogs.data as { entries?: unknown[] } | null)?.entries?.length ?? 0) === 0) {
  throw new Error("File log precheck returned no timeout logs");
}

if (precheckHealth.provider !== "springboot") {
  throw new Error("Spring Boot health precheck did not use springboot provider");
}

const task = await diagnoseIncident("inc-nexus-preview-degraded", {
  maxSteps: 10,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  allowFallback: false,
  timeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 12000),
  maxRetries: 0
});

let finalTask: DiagnosisTask = task;
if (task.status === "WAITING_FOR_APPROVAL" && task.checkpoint) {
  const decision: ApprovalDecision = {
    status: "APPROVED",
    comment: "approved for strict LLM verification; recommendation only, no dangerous action executed",
    actor: "verify:nexus:llm",
    decidedAt: new Date().toISOString()
  };
  finalTask = await resumeDiagnosisFromCheckpoint(task.checkpoint, decision, {
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
    deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    allowFallback: false,
    timeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 12000),
    maxRetries: 0
  });
}

const allSteps = [...task.steps, ...finalTask.steps.slice(task.steps.length)];
const calledTools = allSteps
  .filter((item) => item.type === "TOOL")
  .map((item) => item.toolName)
  .filter((toolName): toolName is ToolName => typeof toolName === "string") as ToolName[];
const requiredTools: ToolName[] = ["metric_query", "log_search", "dependency_trace", "service_health"];
const evidenceText = JSON.stringify(finalTask.diagnosis?.evidence ?? task.checkpoint?.state.evidence ?? []);

if (task.agentRun?.modelSource !== "deepseek" || finalTask.diagnosis?.modelSource !== "deepseek") {
  throw new Error("modelSource must be deepseek");
}

if (task.agentRun?.fallbackUsed || finalTask.agentRun?.fallbackUsed) {
  throw new Error("fallbackUsed must be false");
}

for (const toolName of requiredTools) {
  if (!calledTools.includes(toolName)) {
    throw new Error(`DeepSeek did not call required tool ${toolName}`);
  }
}

for (const marker of ["prometheus", "file", "springboot", "dependency"]) {
  if (!evidenceText.toLowerCase().includes(marker)) {
    throw new Error(`Evidence does not include ${marker}`);
  }
}

const diagnosisText = `${finalTask.diagnosis?.rootCause ?? ""} ${finalTask.diagnosis?.impact ?? ""} ${finalTask.diagnosis?.recommendation ?? ""}`.toLowerCase();
const semanticChecks: Array<[string, RegExp]> = [
  ["order-service", /order-service/i],
  ["product-service", /product-service/i],
  ["downstream failure", /timeout|timed out|超时|failed|不可用|unavailable|unreachable|不可达/i],
  ["fallback", /fallback|降级/i],
  ["degraded", /degraded|受损|降级/i]
];

for (const [label, pattern] of semanticChecks) {
  if (!pattern.test(diagnosisText)) {
    throw new Error(`Diagnosis does not mention ${label}: ${diagnosisText}`);
  }
}

console.log(JSON.stringify({
  initialStatus: task.status,
  finalStatus: finalTask.status,
  modelSource: finalTask.diagnosis?.modelSource,
  fallbackUsed: finalTask.agentRun?.fallbackUsed,
  calledTools,
  evidenceSources: finalTask.diagnosis?.evidence.map((item) => item.source),
  diagnosis: finalTask.diagnosis?.rootCause
}, null, 2));
