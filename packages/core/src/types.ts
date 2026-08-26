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

export type ToolContext = {
  incidentId?: string;
  serviceId?: string;
};

export type ToolResult<T> = {
  result: T;
  metadata: {
    tool: string;
    durationMs: number;
    mock: boolean;
  };
};

export type EvidenceItem = {
  source: string;
  title: string;
  detail: string;
  confidence: number;
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
};

export type AgentStepStatus = "completed" | "failed";

export type AgentStep = {
  id: string;
  title: string;
  description: string;
  tool: string;
  status: AgentStepStatus;
  durationMs: number;
  summary: string;
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
  errorMessage?: string;
};
