import { metrics } from "../../mockData";
import type { MetricQueryRequest, MetricQueryResult } from "../types";
import type { MetricsProvider } from "./MetricsProvider";

export class MockMetricsProvider implements MetricsProvider {
  readonly name = "mock";

  async query(request: MetricQueryRequest): Promise<MetricQueryResult> {
    const startedAt = Date.now();
    const points = metrics[request.service] ?? [];

    return {
      success: true,
      provider: this.name,
      series: [
        {
          metricName: request.metric,
          service: request.service,
          labels: {
            target: request.target
          },
          points: points.map((point) => ({
            timestamp: point.timestamp,
            value:
              request.metric === "http_error_rate"
                ? point.errorRate
                : request.metric === "process_cpu"
                  ? point.cpu
                  : point.latencyMs
          }))
        }
      ],
      latencyMs: Date.now() - startedAt
    };
  }
}
