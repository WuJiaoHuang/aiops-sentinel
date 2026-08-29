import type { TargetConfig, HealthQueryRequest, HealthQueryResult, ServiceHealth } from "../types";
import type { HealthProvider } from "./HealthProvider";

type ActuatorHealth = {
  status?: string;
  components?: Record<string, unknown>;
};

const normalizeStatus = (status?: string): ServiceHealth["status"] => {
  if (status === "UP") {
    return "UP";
  }

  if (status === "DOWN") {
    return "DOWN";
  }

  if (status === "OUT_OF_SERVICE") {
    return "DEGRADED";
  }

  return "UNKNOWN";
};

export class SpringBootHealthProvider implements HealthProvider {
  readonly name = "springboot";

  constructor(private readonly target: TargetConfig) {}

  async getHealth(request: HealthQueryRequest): Promise<HealthQueryResult> {
    const startedAt = Date.now();

    if (!this.target.baseUrl) {
      return {
        success: false,
        provider: this.name,
        health: {
          service: request.service,
          status: "UNKNOWN",
          checkedAt: new Date().toISOString()
        },
        error: `target ${request.target} 未配置 baseUrl`,
        latencyMs: Date.now() - startedAt
      };
    }

    try {
      const response = await fetch(new URL("/actuator/health", this.target.baseUrl));
      const payload = (await response.json()) as ActuatorHealth;
      const health = {
        service: request.service,
        status: normalizeStatus(payload.status),
        components: {
          ...payload.components,
          target: request.target,
          provider: this.name
        },
        checkedAt: new Date().toISOString()
      };

      return {
        success: response.ok,
        provider: this.name,
        health,
        error: response.ok ? undefined : `Actuator health HTTP ${response.status}`,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        success: false,
        provider: this.name,
        health: {
          service: request.service,
          status: "UNKNOWN",
          checkedAt: new Date().toISOString()
        },
        error: error instanceof Error ? error.message : "Actuator health 查询失败",
        latencyMs: Date.now() - startedAt
      };
    }
  }
}
