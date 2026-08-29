import type { HealthQueryRequest, HealthQueryResult } from "../types";

export interface HealthProvider {
  readonly name: string;
  getHealth(request: HealthQueryRequest): Promise<HealthQueryResult>;
}
