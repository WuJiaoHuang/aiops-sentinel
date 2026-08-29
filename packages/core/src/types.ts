export type Severity = "critical" | "warning" | "info";

export type Service = {
  id: string;
  name: string;
  owner: string;
  runtime: string;
  dependencies: string[];
};

export type MetricPoint = {
  timestamp: string;
  latencyMs: number;
  errorRate: number;
  cpu: number;
  memory: number;
};

export type LogEntry = {
  id: string;
  serviceId: string;
  timestamp: string;
  level: "error" | "warn" | "info";
  message: string;
  traceId: string;
};

export type Incident = {
  id: string;
  serviceId: string;
  title: string;
  severity: Severity;
  status: "open" | "investigating" | "resolved";
  startedAt: string;
  summary: string;
};

export type UserRole = "admin" | "viewer";

export type CurrentUser = {
  id: string;
  name: string;
  role: UserRole;
  team: string;
};

export type AuditAction = "login" | "logout" | "create_diagnosis_task" | "view_console";

export type AuditEvent = {
  id: string;
  action: AuditAction;
  actorId: string;
  actorName: string;
  target: string;
  detail: string;
  createdAt: string;
};

export type JsonSchema = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolContext = {
  incidentId?: string;
  serviceId?: string;
};

export type ToolName =
  | "incident_summary"
  | "log_search"
  | "metric_query"
  | "dependency_trace"
  | "knowledge_search"
  | "rollback_advisor"
  | "service_health";

export type McpToolName =
  | "incident_summary"
  | "query_logs"
  | "query_metrics"
  | "query_dependency"
  | "search_knowledge"
  | "rollback_advisor"
  | "get_service_health";

export type ToolResult<T = unknown> = {
  success: boolean;
  data: T | null;
  error: string | null;
  source: "mock" | "mcp" | "api";
  provider?: string;
  latencyMs: number;
  timestamp: string;
};

export type ToolDefinition<TOutput = unknown> = {
  name: ToolName;
  mcpName: McpToolName;
  description: string;
  inputSchema: JsonSchema;
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<ToolResult<TOutput>> | ToolResult<TOutput>;
};

export type ToolCallRecord = {
  toolName: ToolName;
  mcpName: McpToolName;
  input: Record<string, unknown>;
  result?: ToolResult;
  timestamp: string;
};

export type EvidenceItem = {
  source: string;
  title: string;
  detail: string;
  confidence: number;
};

export type ActionProposal = {
  action: string;
  reason: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  evidence: string[];
  requiresApproval: boolean;
};

export type Diagnosis = {
  incidentId: string;
  modelSource: "deepseek" | "mock";
  rootCause: string;
  confidence: number;
  impact: string;
  recommendation: string;
  rollbackAdvice: string;
  evidence: EvidenceItem[];
  actionProposals?: ActionProposal[];
  uncertain?: boolean;
};

export type AgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
};

export type AgentState = {
  messages: AgentMessage[];
  incident: Incident;
  evidence: EvidenceItem[];
  toolCalls: ToolCallRecord[];
  currentHypothesis: string;
  confidence: number;
  stepCount: number;
  finalDiagnosis: Diagnosis | null;
};

export type AgentStepType = "LLM" | "TOOL" | "ERROR" | "FINAL";

export type AgentStepStatus = "completed" | "failed" | "skipped";

export type AgentStep = {
  id: string;
  stepIndex: number;
  type: AgentStepType;
  title: string;
  description: string;
  toolName?: ToolName | McpToolName | "agent_runtime" | "diagnosis_task_queue";
  toolInput?: Record<string, unknown>;
  toolOutput?: ToolResult | Diagnosis | Record<string, unknown>;
  status: AgentStepStatus;
  latency: number;
  timestamp: string;
  summary: string;
};

export type AgentRun = {
  runId: string;
  incidentId: string;
  model: string;
  status: "running" | "completed" | "failed";
  startTime: string;
  endTime: string;
  totalLatency: number;
  totalToolCalls: number;
  finalDiagnosis: Diagnosis | null;
  confidence: number;
  steps: AgentStep[];
};

export type DiagnosisTask = {
  id: string;
  incidentId: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  steps: AgentStep[];
  diagnosis: Diagnosis | null;
  agentRun?: AgentRun;
  errorMessage?: string;
};
