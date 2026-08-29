import type { HealthQueryRequest, HealthQueryResult } from "../types";
import type { HealthProvider } from "./HealthProvider";

export class MockHealthProvider implements HealthProvider {
  readonly name = "mock";

  async getHealth(request: HealthQueryRequest): Promise<HealthQueryResult> {
    const startedAt = Date.now();

    return {
      success: true,
      provider: this.name,
      health: {
        service: request.service,
        status: "UP",
        components: {
          target: request.target
        },
        checkedAt: new Date().toISOString()
      },
      latencyMs: Date.now() - startedAt
    };
  }
}
