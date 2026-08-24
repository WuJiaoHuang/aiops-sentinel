import React from "react";
import { createRoot } from "react-dom/client";
import { Activity, AlertTriangle, Bot, Network, Terminal } from "lucide-react";
import { diagnoseIncident, incidents, logs, metrics, services } from "@aiops-sentinel/core";
import "./styles.css";

const selectedIncident = incidents[0];
const selectedService = services.find((service) => service.id === selectedIncident.serviceId) ?? services[0];
const metricSeries = metrics[selectedService.id] ?? [];

const App = () => {
  const [diagnosis, setDiagnosis] = React.useState<Awaited<ReturnType<typeof diagnoseIncident>> | null>(null);
  const [loading, setLoading] = React.useState(false);

  const runDiagnosis = async () => {
    setLoading(true);
    setDiagnosis(await diagnoseIncident(selectedIncident.id));
    setLoading(false);
  };

  React.useEffect(() => {
    void runDiagnosis();
  }, []);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Activity size={26} />
          <span>AIOps Sentinel</span>
        </div>
        <nav>
          <button className="active" title="Incident console">
            <AlertTriangle size={18} />
            Incidents
          </button>
          <button title="Service topology">
            <Network size={18} />
            Topology
          </button>
          <button title="Agent diagnosis">
            <Bot size={18} />
            Agent
          </button>
          <button title="CLI workflow">
            <Terminal size={18} />
            CLI
          </button>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Production Incident</p>
            <h1>{selectedIncident.title}</h1>
          </div>
          <button className="primary" onClick={runDiagnosis} disabled={loading}>
            <Bot size={18} />
            {loading ? "Diagnosing" : "Run Diagnosis"}
          </button>
        </header>

        <section className="grid">
          <article className="panel incident">
            <div className="panelHead">
              <h2>Incident Status</h2>
              <span className={`badge ${selectedIncident.severity}`}>{selectedIncident.severity}</span>
            </div>
            <p>{selectedIncident.summary}</p>
            <dl>
              <div>
                <dt>Service</dt>
                <dd>{selectedService.name}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{selectedService.owner}</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>{selectedService.runtime}</dd>
              </div>
            </dl>
          </article>

          <article className="panel">
            <div className="panelHead">
              <h2>Metric Window</h2>
              <span className="muted">latency / error rate</span>
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

          <article className="panel wide">
            <div className="panelHead">
              <h2>Agent Diagnosis</h2>
              <span className="muted">DeepSeek-ready with mock fallback</span>
            </div>
            {diagnosis ? (
              <div className="diagnosis">
                <h3>{diagnosis.rootCause}</h3>
                <p>{diagnosis.impact}</p>
                <p>{diagnosis.recommendation}</p>
                <div className="confidence">
                  <span>Confidence</span>
                  <strong>{Math.round(diagnosis.confidence * 100)}%</strong>
                </div>
              </div>
            ) : (
              <p className="muted">Waiting for diagnosis...</p>
            )}
          </article>

          <article className="panel">
            <div className="panelHead">
              <h2>Evidence Chain</h2>
              <span className="muted">MCP tools</span>
            </div>
            <div className="evidence">
              {diagnosis?.evidence.map((item) => (
                <div key={`${item.source}-${item.title}`}>
                  <strong>{item.source}</strong>
                  <span>{item.detail}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panelHead">
              <h2>Recent Logs</h2>
              <span className="muted">{selectedService.name}</span>
            </div>
            <div className="logs">
              {logs
                .filter((log) => log.serviceId === selectedService.id)
                .map((log) => (
                  <code key={log.id}>
                    [{log.level}] {log.message}
                  </code>
                ))}
            </div>
          </article>
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
