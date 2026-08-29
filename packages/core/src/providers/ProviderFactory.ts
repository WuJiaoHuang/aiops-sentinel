import type { TargetConfig } from "./types";
import { MockHealthProvider } from "./health/MockHealthProvider";
import { SpringBootHealthProvider } from "./health/SpringBootHealthProvider";
import type { HealthProvider } from "./health/HealthProvider";
import { FileLogProvider } from "./logs/FileLogProvider";
import { MockLogProvider } from "./logs/MockLogProvider";
import type { LogProvider } from "./logs/LogProvider";
import { MockMetricsProvider } from "./metrics/MockMetricsProvider";
import { PrometheusMetricsProvider } from "./metrics/PrometheusMetricsProvider";
import type { MetricsProvider } from "./metrics/MetricsProvider";
import { getTargetConfig } from "./target/TargetConfigLoader";

export const createMetricsProvider = (target: TargetConfig): MetricsProvider => {
  if ((process.env.METRICS_PROVIDER ?? target.metricsProvider) === "prometheus") {
    return new PrometheusMetricsProvider(target);
  }

  return new MockMetricsProvider();
};

export const createLogProvider = (target: TargetConfig): LogProvider => {
  if ((process.env.LOG_PROVIDER ?? target.logProvider) === "file") {
    return new FileLogProvider(target);
  }

  return new MockLogProvider();
};

export const createHealthProvider = (target: TargetConfig): HealthProvider => {
  if ((process.env.HEALTH_PROVIDER ?? target.healthProvider) === "springboot") {
    return new SpringBootHealthProvider(target);
  }

  return new MockHealthProvider();
};

export const createProvidersForTarget = (targetName?: string) => {
  const target = getTargetConfig(targetName);

  return {
    target,
    metricsProvider: createMetricsProvider(target),
    logProvider: createLogProvider(target),
    healthProvider: createHealthProvider(target)
  };
};
