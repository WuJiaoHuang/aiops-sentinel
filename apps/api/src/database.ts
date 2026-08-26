import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { incidents, logs, metrics, services } from "@aiops-sentinel/core";
import type { AuditEvent, DiagnosisTask, Incident, LogEntry, MetricPoint, Service } from "@aiops-sentinel/core";

const apiDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(apiDir, "../../..");
const dataDir = path.join(repoRoot, "data");
const databasePath = path.join(dataDir, "sentinel.sqlite");

fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(databasePath);

const readJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const initializeDatabase = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      runtime TEXT NOT NULL,
      dependencies TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      title TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      summary TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      trace_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      error_rate REAL NOT NULL,
      cpu INTEGER NOT NULL,
      memory INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS diagnosis_tasks (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      total_duration_ms INTEGER NOT NULL,
      steps TEXT NOT NULL,
      diagnosis TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      target TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  seedTable("services", () => {
    const insert = db.prepare(
      "INSERT INTO services (id, name, owner, runtime, dependencies) VALUES (?, ?, ?, ?, ?)"
    );
    services.forEach((service) => {
      insert.run(service.id, service.name, service.owner, service.runtime, JSON.stringify(service.dependencies));
    });
  });

  seedTable("incidents", () => {
    const insert = db.prepare(
      "INSERT INTO incidents (id, service_id, title, severity, status, started_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    incidents.forEach((incident) => {
      insert.run(
        incident.id,
        incident.serviceId,
        incident.title,
        incident.severity,
        incident.status,
        incident.startedAt,
        incident.summary
      );
    });
  });

  seedTable("logs", () => {
    const insert = db.prepare(
      "INSERT INTO logs (id, service_id, timestamp, level, message, trace_id) VALUES (?, ?, ?, ?, ?, ?)"
    );
    logs.forEach((log) => {
      insert.run(log.id, log.serviceId, log.timestamp, log.level, log.message, log.traceId);
    });
  });

  seedTable("metrics", () => {
    const insert = db.prepare(
      "INSERT INTO metrics (service_id, timestamp, latency_ms, error_rate, cpu, memory) VALUES (?, ?, ?, ?, ?, ?)"
    );
    Object.entries(metrics).forEach(([serviceId, points]) => {
      points.forEach((point) => {
        insert.run(serviceId, point.timestamp, point.latencyMs, point.errorRate, point.cpu, point.memory);
      });
    });
  });
};

const seedTable = (tableName: string, seed: () => void) => {
  const row = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as { count: number };
  if (row.count === 0) {
    seed();
  }
};

export const repository = {
  services: (): Service[] => {
    const rows = db.prepare("SELECT * FROM services ORDER BY id").all() as Array<{
      id: string;
      name: string;
      owner: string;
      runtime: string;
      dependencies: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      owner: row.owner,
      runtime: row.runtime,
      dependencies: readJson<string[]>(row.dependencies, [])
    }));
  },

  incidents: (): Incident[] => {
    const rows = db.prepare("SELECT * FROM incidents ORDER BY started_at DESC").all() as Array<{
      id: string;
      service_id: string;
      title: string;
      severity: Incident["severity"];
      status: Incident["status"];
      started_at: string;
      summary: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      serviceId: row.service_id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      startedAt: row.started_at,
      summary: row.summary
    }));
  },

  logs: (serviceId?: string): LogEntry[] => {
    const statement = serviceId
      ? db.prepare("SELECT * FROM logs WHERE service_id = ? ORDER BY timestamp DESC")
      : db.prepare("SELECT * FROM logs ORDER BY timestamp DESC");
    const rows = (serviceId ? statement.all(serviceId) : statement.all()) as Array<{
      id: string;
      service_id: string;
      timestamp: string;
      level: LogEntry["level"];
      message: string;
      trace_id: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      serviceId: row.service_id,
      timestamp: row.timestamp,
      level: row.level,
      message: row.message,
      traceId: row.trace_id
    }));
  },

  metrics: (): Record<string, MetricPoint[]> => {
    const rows = db.prepare("SELECT * FROM metrics ORDER BY service_id, id").all() as Array<{
      service_id: string;
      timestamp: string;
      latency_ms: number;
      error_rate: number;
      cpu: number;
      memory: number;
    }>;

    return rows.reduce<Record<string, MetricPoint[]>>((acc, row) => {
      acc[row.service_id] = acc[row.service_id] ?? [];
      acc[row.service_id].push({
        timestamp: row.timestamp,
        latencyMs: row.latency_ms,
        errorRate: row.error_rate,
        cpu: row.cpu,
        memory: row.memory
      });
      return acc;
    }, {});
  },

  saveDiagnosisTask: (task: DiagnosisTask) => {
    db.prepare(
      `INSERT OR REPLACE INTO diagnosis_tasks
       (id, incident_id, status, started_at, completed_at, total_duration_ms, steps, diagnosis)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      task.id,
      task.incidentId,
      task.status,
      task.startedAt,
      task.completedAt,
      task.totalDurationMs,
      JSON.stringify(task.steps),
      JSON.stringify(task.diagnosis)
    );
  },

  diagnosisTasks: (incidentId?: string): DiagnosisTask[] => {
    const statement = incidentId
      ? db.prepare("SELECT * FROM diagnosis_tasks WHERE incident_id = ? ORDER BY completed_at DESC")
      : db.prepare("SELECT * FROM diagnosis_tasks ORDER BY completed_at DESC");
    const rows = (incidentId ? statement.all(incidentId) : statement.all()) as Array<{
      id: string;
      incident_id: string;
      status: DiagnosisTask["status"];
      started_at: string;
      completed_at: string;
      total_duration_ms: number;
      steps: string;
      diagnosis: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      totalDurationMs: row.total_duration_ms,
      steps: readJson(row.steps, []),
      diagnosis: readJson(row.diagnosis, {
        incidentId: row.incident_id,
        modelSource: "mock",
        rootCause: "暂无诊断结果",
        confidence: 0,
        impact: "暂无",
        recommendation: "暂无",
        rollbackAdvice: "暂无",
        evidence: []
      })
    }));
  },

  diagnosisTask: (taskId: string): DiagnosisTask | undefined => {
    return repository.diagnosisTasks().find((task) => task.id === taskId);
  },

  saveAuditEvent: (event: AuditEvent) => {
    db.prepare(
      `INSERT INTO audit_events
       (id, action, actor_id, actor_name, target, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(event.id, event.action, event.actorId, event.actorName, event.target, event.detail, event.createdAt);
  },

  auditEvents: (): AuditEvent[] => {
    const rows = db.prepare("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 30").all() as Array<{
      id: string;
      action: AuditEvent["action"];
      actor_id: string;
      actor_name: string;
      target: string;
      detail: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorId: row.actor_id,
      actorName: row.actor_name,
      target: row.target,
      detail: row.detail,
      createdAt: row.created_at
    }));
  }
};
