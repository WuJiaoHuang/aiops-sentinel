import type { TargetConfig, MetricQueryRequest, MetricQueryResult, MetricSeries } from "../types";
import { resolvePromQl } from "./MetricCatalog";
import type { MetricsProvider } from "./MetricsProvider";

type PrometheusVectorResult = {
  metric: Record<string, string>;
  value?: [number, string];
  values?: Array<[number, string]>;
};

type PrometheusResponse = {
  status: "success" | "error";
  data?: {
    result?: PrometheusVectorResult[];
  };
  error?: string;
};

export class PrometheusMetricsProvider implements MetricsProvider {
  readonly name = "prometheus";

  constructor(
    private readonly target: TargetConfig,
    private readonly baseUrl = process.env.PROMETHEUS_BASE_URL ?? "http://localhost:9090"
  ) {}

  async query(request: MetricQueryRequest): Promise<MetricQueryResult> {
    const startedAt = Date.now();
    const query = resolvePromQl(request.metric, this.target, request.service);
    const minutes = request.timeRangeMinutes ?? 10;
    const end = Math.floor(Date.now() / 1000);
    const start = end - minutes * 60;
    const url = new URL("/api/v1/query_range", this.baseUrl);
    url.searchParams.set("query", query);
    url.searchParams.set("start", String(start));
    url.searchParams.set("end", String(end));
    url.searchParams.set("step", "30");

    try {
      const response = await fetch(url);
      const payload = (await response.json()) as PrometheusResponse;

      if (!response.ok || payload.status !== "success") {
        return {
          success: false,
          provider: this.name,
          series: [],
          error: payload.error ?? `Prometheus HTTP ${response.status}`,
          latencyMs: Date.now() - startedAt
        };
      }

      return {
        success: true,
        provider: this.name,
        series: this.toSeries(request, payload.data?.result ?? []),
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        success: false,
        provider: this.name,
        series: [],
        error: error instanceof Error ? error.message : "Prometheus 查询失败",
        latencyMs: Date.now() - startedAt
      };
    }
  }

  private toSeries(request: MetricQueryRequest, results: PrometheusVectorResult[]): MetricSeries[] {
    return results.map((result) => ({
      metricName: request.metric,
      service: request.service,
      labels: {
        ...result.metric,
        target: request.target,
        provider: this.name
      },
      points: (result.values ?? (result.value ? [result.value] : [])).map(([timestamp, value]) => ({
        timestamp: new Date(timestamp * 1000).toISOString(),
        value: Number(value)
      }))
    }));
  }
}
