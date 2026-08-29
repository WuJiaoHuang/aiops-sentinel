import type { Incident, LogEntry, MetricPoint, Service } from "./types";

export const services: Service[] = [
  {
    id: "svc-gateway",
    name: "api-gateway",
    owner: "platform",
    runtime: "Java 17 / Spring Boot 3",
    dependencies: ["svc-auth", "svc-order"]
  },
  {
    id: "svc-auth",
    name: "auth-service",
    owner: "identity",
    runtime: "Java 17 / Spring Security",
    dependencies: ["svc-redis"]
  },
  {
    id: "svc-order",
    name: "order-service",
    owner: "commerce",
    runtime: "Java 17 / Spring Boot 3",
    dependencies: ["svc-mysql", "svc-redis"]
  },
  {
    id: "svc-redis",
    name: "redis-cache",
    owner: "infra",
    runtime: "Redis 7",
    dependencies: []
  },
  {
    id: "svc-mysql",
    name: "mysql-primary",
    owner: "infra",
    runtime: "MySQL 8",
    dependencies: []
  }
];

export const incidents: Incident[] = [
  {
    id: "inc-20260824-001",
    serviceId: "svc-order",
    title: "下单接口错误率突增",
    severity: "critical",
    status: "investigating",
    startedAt: "2026-08-24T08:12:00.000Z",
    summary: "最近一次发布后，下单接口错误率升至 12% 以上，影响支付确认链路。"
  },
  {
    id: "inc-20260824-002",
    serviceId: "svc-auth",
    title: "登录接口延迟超过 SLO",
    severity: "warning",
    status: "open",
    startedAt: "2026-08-24T09:25:00.000Z",
    summary: "移动端登录请求 P95 延迟超过 900ms，用户仍可登录但体验明显变慢。"
  }
];

export const logs: LogEntry[] = [
  {
    id: "log-1",
    serviceId: "svc-order",
    timestamp: "2026-08-24T08:14:31.000Z",
    level: "error",
    message: "支付服务重试预算耗尽后仍然超时",
    traceId: "tr-7801"
  },
  {
    id: "log-2",
    serviceId: "svc-order",
    timestamp: "2026-08-24T08:15:02.000Z",
    level: "error",
    message: "POST /checkout 请求因上游超时失败",
    traceId: "tr-7802"
  },
  {
    id: "log-3",
    serviceId: "svc-auth",
    timestamp: "2026-08-24T09:29:10.000Z",
    level: "warn",
    message: "Redis token 查询 P95 延迟超过 420ms",
    traceId: "tr-1102"
  }
];

export const metrics: Record<string, MetricPoint[]> = {
  "svc-order": [
    { timestamp: "08:00", latencyMs: 180, errorRate: 0.8, cpu: 44, memory: 61 },
    { timestamp: "08:05", latencyMs: 260, errorRate: 2.1, cpu: 51, memory: 63 },
    { timestamp: "08:10", latencyMs: 620, errorRate: 9.4, cpu: 68, memory: 70 },
    { timestamp: "08:15", latencyMs: 880, errorRate: 13.2, cpu: 73, memory: 72 },
    { timestamp: "08:20", latencyMs: 810, errorRate: 12.5, cpu: 70, memory: 72 }
  ],
  "svc-auth": [
    { timestamp: "09:10", latencyMs: 390, errorRate: 0.4, cpu: 39, memory: 55 },
    { timestamp: "09:15", latencyMs: 470, errorRate: 0.6, cpu: 42, memory: 58 },
    { timestamp: "09:20", latencyMs: 760, errorRate: 1.4, cpu: 50, memory: 61 },
    { timestamp: "09:25", latencyMs: 930, errorRate: 1.8, cpu: 55, memory: 62 }
  ]
};
