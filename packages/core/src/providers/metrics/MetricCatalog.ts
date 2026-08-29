import type { TargetConfig } from "../types";

export type LogicalMetric =
  | "http_request_count"
  | "http_latency"
  | "http_error_count"
  | "http_error_rate"
  | "jvm_memory"
  | "jvm_gc"
  | "process_cpu"
  | "system_cpu"
  | "db_pool_active"
  | "db_pool_idle"
  | "db_pool_pending"
  | "db_pool_max";

const byJob = (target: TargetConfig) => target.prometheusJob ?? target.name;

export const resolvePromQl = (metric: string, target: TargetConfig, service: string) => {
  const job = byJob(target);
  const safeService = service || target.name;
  const catalog: Record<string, string> = {
    http_request_count: `sum(rate(http_server_requests_seconds_count{job="${job}"}[5m]))`,
    http_latency: `histogram_quantile(0.99, sum(rate(http_server_requests_seconds_bucket{job="${job}"}[5m])) by (le, uri, method))`,
    http_error_count: `sum(rate(http_server_requests_seconds_count{job="${job}",status=~"5.."}[5m]))`,
    http_error_rate: `sum(rate(http_server_requests_seconds_count{job="${job}",status=~"5.."}[5m])) / clamp_min(sum(rate(http_server_requests_seconds_count{job="${job}"}[5m])), 0.001)`,
    jvm_memory: `sum(jvm_memory_used_bytes{job="${job}"}) by (area)`,
    jvm_gc: `sum(rate(jvm_gc_pause_seconds_count{job="${job}"}[5m]))`,
    process_cpu: `process_cpu_usage{job="${job}"}`,
    system_cpu: `system_cpu_usage{job="${job}"}`,
    db_pool_active: `hikaricp_connections_active{job="${job}"}`,
    db_pool_idle: `hikaricp_connections_idle{job="${job}"}`,
    db_pool_pending: `hikaricp_connections_pending{job="${job}"}`,
    db_pool_max: `hikaricp_connections_max{job="${job}"}`,
    cityeats_shop_query_total: `cityeats_shop_query_total{job="${job}",service="${safeService}"}`,
    cityeats_shop_query_latency: `histogram_quantile(0.99, sum(rate(cityeats_shop_query_latency_seconds_bucket{job="${job}",service="${safeService}"}[5m])) by (le))`,
    cityeats_seckill_request_total: `cityeats_seckill_request_total{job="${job}",service="${safeService}"}`,
    cityeats_seckill_success_total: `cityeats_seckill_success_total{job="${job}",service="${safeService}"}`,
    cityeats_seckill_failure_total: `cityeats_seckill_failure_total{job="${job}",service="${safeService}"}`,
    cityeats_order_create_total: `cityeats_order_create_total{job="${job}",service="${safeService}"}`,
    cityeats_cache_hit_total: `cityeats_cache_hit_total{job="${job}",service="${safeService}"}`,
    cityeats_cache_miss_total: `cityeats_cache_miss_total{job="${job}",service="${safeService}"}`
  };

  return catalog[metric] ?? metric;
};
