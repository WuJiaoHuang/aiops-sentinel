import React from "react";
import { createRoot } from "react-dom/client";
import { Activity, AlertTriangle, Bot, Network, Terminal } from "lucide-react";
import { diagnoseIncident, incidents, logs, metrics, services } from "@aiops-sentinel/core";
import "./styles.css";

const selectedIncident = incidents[0];
const selectedService = services.find((service) => service.id === selectedIncident.serviceId) ?? services[0];
const metricSeries = metrics[selectedService.id] ?? [];
const severityLabel = {
  critical: "严重",
  warning: "警告",
  info: "提示"
} as const;

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
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">生产故障</p>
            <h1>{selectedIncident.title}</h1>
          </div>
          <button className="primary" onClick={runDiagnosis} disabled={loading}>
            <Bot size={18} />
            {loading ? "诊断中" : "重新诊断"}
          </button>
        </header>

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
                <dt>运行环境</dt>
                <dd>{selectedService.runtime}</dd>
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

          <article className="panel wide">
            <div className="panelHead">
              <h2>Agent 诊断</h2>
              <span className="muted">支持 DeepSeek，未配置时自动 mock</span>
            </div>
            {diagnosis ? (
              <div className="diagnosis">
                <h3>{diagnosis.rootCause}</h3>
                <p>{diagnosis.impact}</p>
                <p>{diagnosis.recommendation}</p>
                <div className="confidence">
                  <span>置信度</span>
                  <strong>{Math.round(diagnosis.confidence * 100)}%</strong>
                </div>
              </div>
            ) : (
              <p className="muted">正在等待诊断结果...</p>
            )}
          </article>

          <article className="panel">
            <div className="panelHead">
              <h2>证据链</h2>
              <span className="muted">MCP 工具调用</span>
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
              <h2>近期日志</h2>
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
