import type { MetricQueryRequest, MetricQueryResult } from "../types";

export interface MetricsProvider {
  readonly name: string;
  query(request: MetricQueryRequest): Promise<MetricQueryResult>;
}
