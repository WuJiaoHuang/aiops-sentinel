import React from "react";
import { createRoot } from "react-dom/client";
import { Activity, AlertTriangle, Bot, CheckCircle2, Network, RotateCcw, Terminal } from "lucide-react";
import {
  diagnoseIncident,
  incidents as fallbackIncidents,
  logs as fallbackLogs,
  metrics as fallbackMetrics,
  services as fallbackServices
} from "@aiops-sentinel/core";
import type { DiagnosisTask, Incident, LogEntry, MetricPoint, Service } from "@aiops-sentinel/core";
import "./styles.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

type ConsoleData = {
  services: Service[];
  incidents: Incident[];
  logs: LogEntry[];
  metrics: Record<string, MetricPoint[]>;
};

const fallbackConsoleData: ConsoleData = {
  services: fallbackServices,
  incidents: fallbackIncidents,
  logs: fallbackLogs,
  metrics: fallbackMetrics
};

const severityLabel = {
  critical: "严重",
  warning: "警告",
  info: "提示"
} as const;

const statusLabel = {
  open: "待处理",
  investigating: "诊断中",
  resolved: "已恢复"
} as const;

const fetchJson = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`接口请求失败：${response.status}`);
  }

  return response.json() as Promise<T>;
};

const App = () => {
  const [consoleData, setConsoleData] = React.useState<ConsoleData>(fallbackConsoleData);
  const [selectedIncidentId, setSelectedIncidentId] = React.useState(fallbackIncidents[0].id);
  const [diagnosisTask, setDiagnosisTask] = React.useState<DiagnosisTask | null>(null);
  const [loadingConsole, setLoadingConsole] = React.useState(true);
  const [loadingDiagnosis, setLoadingDiagnosis] = React.useState(false);
  const [apiMode, setApiMode] = React.useState<"api" | "local">("local");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const selectedIncident =
    consoleData.incidents.find((incident) => incident.id === selectedIncidentId) ?? consoleData.incidents[0];
  const selectedService =
    consoleData.services.find((service) => service.id === selectedIncident.serviceId) ?? consoleData.services[0];
  const metricSeries = consoleData.metrics[selectedService.id] ?? [];
  const serviceLogs = consoleData.logs.filter((log) => log.serviceId === selectedService.id);
  const dependencyNames = selectedService.dependencies
    .map((dependencyId) => consoleData.services.find((service) => service.id === dependencyId)?.name)
    .filter(Boolean);

  const loadConsole = async () => {
    setLoadingConsole(true);
    try {
      const data = await fetchJson<ConsoleData>(`${apiBaseUrl}/api/console`);
      setConsoleData(data);
      setApiMode("api");
      setErrorMessage(null);
    } catch {
      setConsoleData(fallbackConsoleData);
      setApiMode("local");
      setErrorMessage("后端 API 暂不可用，当前使用本地 mock 数据演示。");
    } finally {
      setLoadingConsole(false);
    }
  };

  const runDiagnosis = async (incidentId = selectedIncidentId) => {
    setLoadingDiagnosis(true);
    try {
      const task =
        apiMode === "api"
          ? await fetchJson<DiagnosisTask>(`${apiBaseUrl}/api/incidents/${incidentId}/diagnose`, { method: "POST" })
          : await diagnoseIncident(incidentId);

      setDiagnosisTask(task);
      setErrorMessage(null);
    } catch {
      const task = await diagnoseIncident(incidentId);
      setDiagnosisTask(task);
      setApiMode("local");
      setErrorMessage("诊断接口调用失败，已切换到本地 Agent mock 结果。");
    } finally {
      setLoadingDiagnosis(false);
    }
  };

  React.useEffect(() => {
    void loadConsole();
  }, []);

  React.useEffect(() => {
    void runDiagnosis(selectedIncidentId);
  }, [selectedIncidentId, apiMode]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Activity size={26} />
          <span>AIOps Sentinel</span>
        </div>
        <nav>
          <button className="active" title="故障控制台">
            <AlertTriangle size={18} />
            故障
          </button>
          <button title="服务拓扑">
            <Network size={18} />
            拓扑
          </button>
          <button title="Agent 诊断">
            <Bot size={18} />
            诊断
          </button>
          <button title="CLI 工作流">
            <Terminal size={18} />
            CLI
          </button>
        </nav>
        <div className="runtime">
          <span>数据来源</span>
          <strong>{apiMode === "api" ? "后端 API" : "本地 mock"}</strong>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">生产故障智能诊断</p>
            <h1>{selectedIncident.title}</h1>
          </div>
          <button className="primary" onClick={() => void runDiagnosis()} disabled={loadingDiagnosis}>
            <Bot size={18} />
            {loadingDiagnosis ? "诊断中" : "重新诊断"}
          </button>
        </header>

        {errorMessage && <div className="notice">{errorMessage}</div>}

        <section className="layout">
          <aside className="incidentList">
            <div className="sectionTitle">
              <h2>故障队列</h2>
              <span>{loadingConsole ? "加载中" : `${consoleData.incidents.length} 条`}</span>
            </div>
            {consoleData.incidents.map((incident) => (
              <button
                className={incident.id === selectedIncidentId ? "incidentItem active" : "incidentItem"}
                key={incident.id}
                onClick={() => setSelectedIncidentId(incident.id)}
              >
                <span className={`dot ${incident.severity}`} />
                <strong>{incident.title}</strong>
                <small>
                  {severityLabel[incident.severity]} · {statusLabel[incident.status]}
                </small>
              </button>
            ))}
          </aside>

          <section className="grid">
            <article className="panel incident">
              <div className="panelHead">
                <h2>故障状态</h2>
                <span className={`badge ${selectedIncident.severity}`}>{severityLabel[selectedIncident.severity]}</span>
              </div>
              <p>{selectedIncident.summary}</p>
              <dl>
                <div>
                  <dt>服务</dt>
                  <dd>{selectedService.name}</dd>
                </div>
                <div>
                  <dt>负责人</dt>
                  <dd>{selectedService.owner}</dd>
                </div>
                <div>
                  <dt>状态</dt>
                  <dd>{statusLabel[selectedIncident.status]}</dd>
                </div>
              </dl>
            </article>

            <article className="panel">
              <div className="panelHead">
                <h2>指标窗口</h2>
                <span className="muted">延迟 / 错误率</span>
              </div>
              <div className="chart">
                {metricSeries.map((point) => (
                  <div className="bar" key={point.timestamp} title={`${point.timestamp}: ${point.latencyMs}ms`}>
                    <span style={{ height: `${Math.min(point.latencyMs / 10, 92)}%` }} />
                    <small>{point.timestamp}</small>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panelHead">
                <h2>服务依赖</h2>
                <span className="muted">{selectedService.runtime}</span>
              </div>
              <div className="topology">
                <strong>{selectedService.name}</strong>
                <span>依赖</span>
                <div>
                  {dependencyNames.length > 0 ? dependencyNames.map((name) => <em key={name}>{name}</em>) : <em>无依赖</em>}
                </div>
              </div>
            </article>

            <article className="panel wide">
              <div className="panelHead">
                <h2>Agent 诊断结论</h2>
                <span className="muted">DeepSeek / mock 双模式</span>
              </div>
              {diagnosisTask ? (
                <div className="diagnosis">
                  <h3>{diagnosisTask.diagnosis.rootCause}</h3>
                  <p>{diagnosisTask.diagnosis.impact}</p>
                  <p>{diagnosisTask.diagnosis.recommendation}</p>
                  <div className="confidence">
                    <span>置信度</span>
                    <strong>{Math.round(diagnosisTask.diagnosis.confidence * 100)}%</strong>
                  </div>
                </div>
              ) : (
                <p className="muted">正在等待诊断结果...</p>
              )}
            </article>

            <article className="panel">
              <div className="panelHead">
                <h2>Agent 步骤流</h2>
                <span className="muted">{diagnosisTask?.totalDurationMs ?? 0}ms</span>
              </div>
              <div className="steps">
                {diagnosisTask?.steps.map((step) => (
                  <div className="step" key={step.id}>
                    <CheckCircle2 size={17} />
                    <div>
                      <strong>{step.title}</strong>
                      <span>{step.summary}</span>
                      <small>
                        {step.tool} · {step.durationMs}ms
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panelHead">
                <h2>证据链</h2>
                <span className="muted">MCP 工具调用</span>
              </div>
              <div className="evidence">
                {diagnosisTask?.diagnosis.evidence.map((item) => (
                  <div key={`${item.source}-${item.title}`}>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                    <small>{item.source}</small>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panelHead">
                <h2>近期日志</h2>
                <span className="muted">{selectedService.name}</span>
              </div>
              <div className="logs">
                {serviceLogs.map((log) => (
                  <code key={log.id}>
                    [{log.level}] {log.message}
                  </code>
                ))}
              </div>
            </article>

            <article className="panel actionPanel">
              <div className="panelHead">
                <h2>处置动作</h2>
                <span className="muted">演示闭环</span>
              </div>
              <button>
                <RotateCcw size={16} />
                生成回滚预案
              </button>
              <button>
                <Terminal size={16} />
                复制 CLI 诊断命令
              </button>
            </article>
          </section>
        </section>
      </section>
    </main>
  );
};

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
