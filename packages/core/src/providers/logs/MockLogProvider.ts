import { logs } from "../../mockData";
import type { LogQueryRequest, LogQueryResult } from "../types";
import type { LogProvider } from "./LogProvider";

export class MockLogProvider implements LogProvider {
  readonly name = "mock";

  async query(request: LogQueryRequest): Promise<LogQueryResult> {
    const startedAt = Date.now();
    const level = request.level?.toLowerCase();
    const keyword = request.keyword?.toLowerCase();
    const entries = logs
      .filter((log) => log.serviceId === request.service)
      .filter((log) => (level ? log.level.toLowerCase() === level : true))
      .filter((log) => (keyword ? log.message.toLowerCase().includes(keyword) : true))
      .slice(0, request.limit ?? 100)
      .map((log) => ({
        timestamp: log.timestamp,
        service: request.service,
        level: log.level,
        message: log.message,
        traceId: log.traceId,
        labels: {
          target: request.target,
          provider: this.name
        }
      }));

    return {
      success: true,
      provider: this.name,
      entries,
      latencyMs: Date.now() - startedAt
    };
  }
}
