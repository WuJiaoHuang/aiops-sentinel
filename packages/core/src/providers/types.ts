export type MetricDataPoint = {
  timestamp: string;
  value: number;
};

export type MetricSeries = {
  metricName: string;
  service: string;
  labels: Record<string, string>;
  points: MetricDataPoint[];
};

export type MetricQueryRequest = {
  target: string;
  service: string;
  metric: string;
  timeRangeMinutes?: number;
};

export type MetricQueryResult = {
  success: boolean;
  provider: string;
  series: MetricSeries[];
  error?: string;
  latencyMs: number;
};

export type ObservabilityLogEntry = {
  timestamp: string;
  service: string;
  level: string;
  message: string;
  traceId?: string;
  labels?: Record<string, string>;
};

export type LogQueryRequest = {
  target: string;
  service: string;
  startTime?: string;
  endTime?: string;
  level?: string;
  keyword?: string;
  limit?: number;
};

export type LogQueryResult = {
  success: boolean;
  provider: string;
  entries: ObservabilityLogEntry[];
  error?: string;
  latencyMs: number;
};

export type HealthQueryRequest = {
  target: string;
  service: string;
};

export type ServiceHealth = {
  service: string;
  status: "UP" | "DOWN" | "DEGRADED" | "UNKNOWN";
  components?: Record<string, unknown>;
  checkedAt: string;
};

export type HealthQueryResult = {
  success: boolean;
  provider: string;
  health: ServiceHealth;
  error?: string;
  latencyMs: number;
};

export type ServiceMetadata = {
  framework?: string;
  dependencies: string[];
};

export type TargetConfig = {
  name: string;
  type: "spring-boot" | "mock" | string;
  baseUrl?: string;
  prometheusJob?: string;
  logProvider?: "file" | "mock" | "loki" | string;
  logPath?: string;
  metricsProvider?: "prometheus" | "mock" | string;
  healthProvider?: "springboot" | "mock" | string;
  services: Record<string, ServiceMetadata>;
};
