import type { LogQueryRequest, LogQueryResult } from "../types";

export interface LogProvider {
  readonly name: string;
  query(request: LogQueryRequest): Promise<LogQueryResult>;
}
