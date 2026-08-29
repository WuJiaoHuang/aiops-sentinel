import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { TargetConfig, LogQueryRequest, LogQueryResult, ObservabilityLogEntry } from "../types";
import type { LogProvider } from "./LogProvider";

export class FileLogProvider implements LogProvider {
  readonly name = "file";

  constructor(private readonly target: TargetConfig) {}

  async query(request: LogQueryRequest): Promise<LogQueryResult> {
    const startedAt = Date.now();
    const logPath = this.target.logPath ? path.resolve(process.cwd(), this.target.logPath) : "";

    if (!logPath || !existsSync(logPath)) {
      return {
        success: false,
        provider: this.name,
        entries: [],
        error: `日志文件不存在：${logPath || "未配置 logPath"}`,
        latencyMs: Date.now() - startedAt
      };
    }

    try {
      const level = request.level?.toLowerCase();
      const keyword = request.keyword?.toLowerCase();
      const startTime = request.startTime ? Date.parse(request.startTime) : Number.NEGATIVE_INFINITY;
      const endTime = request.endTime ? Date.parse(request.endTime) : Number.POSITIVE_INFINITY;
      const entries = readFileSync(logPath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => this.parseLine(line, request.service))
        .filter((entry) => entry.service === request.service)
        .filter((entry) => (level ? entry.level.toLowerCase() === level : true))
        .filter((entry) => (keyword ? entry.message.toLowerCase().includes(keyword) : true))
        .filter((entry) => {
          const timestamp = Date.parse(entry.timestamp);
          return timestamp >= startTime && timestamp <= endTime;
        })
        .slice(-(request.limit ?? 100));

      return {
        success: true,
        provider: this.name,
        entries,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        success: false,
        provider: this.name,
        entries: [],
        error: error instanceof Error ? error.message : "文件日志查询失败",
        latencyMs: Date.now() - startedAt
      };
    }
  }

  private parseLine(line: string, fallbackService: string): ObservabilityLogEntry {
    try {
      const parsed = JSON.parse(line) as Partial<ObservabilityLogEntry> & Record<string, unknown>;
      return {
        timestamp: String(parsed.timestamp ?? parsed["@timestamp"] ?? new Date().toISOString()),
        service: String(parsed.service ?? fallbackService),
        level: String(parsed.level ?? "INFO"),
        message: String(parsed.message ?? line),
        traceId: parsed.traceId ? String(parsed.traceId) : undefined,
        labels: {
          ...((parsed.labels as Record<string, string> | undefined) ?? {}),
          target: this.target.name,
          provider: this.name
        }
      };
    } catch {
      const matched = line.match(/^(?<timestamp>\S+)\s+(?<level>ERROR|WARN|INFO|DEBUG)\s+(?<message>.*)$/);
      return {
        timestamp: matched?.groups?.timestamp ?? new Date().toISOString(),
        service: fallbackService,
        level: matched?.groups?.level ?? "INFO",
        message: matched?.groups?.message ?? line,
        labels: {
          target: this.target.name,
          provider: this.name
        }
      };
    }
  }
}
