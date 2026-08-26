import React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  LogOut,
  Network,
  RotateCcw,
  ShieldCheck,
  Terminal
} from "lucide-react";
import {
  diagnoseIncident,
  incidents as fallbackIncidents,
  logs as fallbackLogs,
  metrics as fallbackMetrics,
  services as fallbackServices
} from "@aiops-sentinel/core";
import type { CurrentUser, DiagnosisTask, Incident, LogEntry, MetricPoint, Service } from "@aiops-sentinel/core";
import "./styles.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const tokenKey = "aiops-sentinel-token";

type ConsoleData = {
  services: Service[];
  incidents: Incident[];
  logs: LogEntry[];
  metrics: Record<string, MetricPoint[]>;
  diagnosisTasks: DiagnosisTask[];
};

type AiStatus = {
  provider: string;
  configured: boolean;
  baseUrl: string;
  model: string;
  fallback: string;
};

type LoginResult = {
  token: string;
  user: CurrentUser;
};

const fallbackConsoleData: ConsoleData = {
  services: fallbackServices,
  incidents: fallbackIncidents,
  logs: fallbackLogs,
  metrics: fallbackMetrics,
  diagnosisTasks: []
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

const fetchJson = async <T,>(url: string, options: RequestInit = {}, token?: string): Promise<T> => {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    throw new Error(`接口请求失败：${response.status}`);
  }

  return response.json() as Promise<T>;
};

const wait = (durationMs: number) => new Promise((resolve) => window.setTimeout(resolve, durationMs));

const App = () => {
  const [token, setToken] = React.useState(() => window.localStorage.getItem(tokenKey) ?? "");
  const [currentUser, setCurrentUser] = React.useState<CurrentUser | null>(null);
  const [consoleData, setConsoleData] = React.useState<ConsoleData>(fallbackConsoleData);
  const [selectedIncidentId, setSelectedIncidentId] = React.useState(fallbackIncidents[0].id);
  const [diagnosisTask, setDiagnosisTask] = React.useState<DiagnosisTask | null>(null);
  const [loadingConsole, setLoadingConsole] = React.useState(true);
  const [loadingDiagnosis, setLoadingDiagnosis] = React.useState(false);
  const [apiMode, setApiMode] = React.useState<"api" | "local">("local");
  const [aiStatus, setAiStatus] = React.useState<AiStatus | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [rollbackPlan, setRollbackPlan] = React.useState<string[]>([]);
  const [copyState, setCopyState] = React.useState("复制 CLI 诊断命令");
  const [loginForm, setLoginForm] = React.useState({ username: "admin", password: "aiops2026" });
  const [loginError, setLoginError] = React.useState("");
  const [loggingIn, setLoggingIn] = React.useState(false);

  const selectedIncident =
    consoleData.incidents.find((incident) => incident.id === selectedIncidentId) ?? consoleData.incidents[0];
  const selectedService =
    consoleData.services.find((service) => service.id === selectedIncident.serviceId) ?? consoleData.services[0];
  const metricSeries = consoleData.metrics[selectedService.id] ?? [];
  const serviceLogs = consoleData.logs.filter((log) => log.serviceId === selectedService.id);
  const diagnosisHistory = consoleData.diagnosisTasks.filter((task) => task.incidentId === selectedIncident.id);
  const dependencyNames = selectedService.dependencies
    .map((dependencyId) => consoleData.services.find((service) => service.id === dependencyId)?.name)
    .filter(Boolean);
  const latestMetric = metricSeries.at(-1);
  const criticalCount = consoleData.incidents.filter((incident) => incident.severity === "critical").length;

  const applyLogin = (result: LoginResult) => {
    window.localStorage.setItem(tokenKey, result.token);
    setToken(result.token);
    setCurrentUser(result.user);
  };

  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError("");

    try {
      const result = await fetchJson<LoginResult>(`${apiBaseUrl}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify(loginForm)
      });
      applyLogin(result);
    } catch {
      setLoginError("登录失败，请检查账号或密码。");
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = async () => {
    if (token) {
      try {
        await fetchJson(`${apiBaseUrl}/api/auth/logout`, { method: "POST" }, token);
      } catch {
        // 本地退出优先保证用户体验。
      }
    }

    window.localStorage.removeItem(tokenKey);
    setToken("");
    setCurrentUser(null);
    setDiagnosisTask(null);
  };

  const loadConsole = async (activeToken = token) => {
    if (!activeToken) {
      setLoadingConsole(false);
      return;
    }

    setLoadingConsole(true);
    try {
      const [user, data, status] = await Promise.all([
        fetchJson<CurrentUser>(`${apiBaseUrl}/api/auth/me`, {}, activeToken),
        fetchJson<ConsoleData>(`${apiBaseUrl}/api/console`, {}, activeToken),
        fetchJson<AiStatus>(`${apiBaseUrl}/api/ai/status`)
      ]);
      setCurrentUser(user);
      setConsoleData(data);
      setApiMode("api");
      setAiStatus(status);
      setErrorMessage(null);
    } catch {
      window.localStorage.removeItem(tokenKey);
      setToken("");
      setCurrentUser(null);
      setConsoleData(fallbackConsoleData);
      setApiMode("local");
      setAiStatus(null);
      setErrorMessage("登录已失效，请重新登录。");
    } finally {
      setLoadingConsole(false);
    }
  };

  const runDiagnosis = async (incidentId = selectedIncidentId) => {
    setLoadingDiagnosis(true);
    try {
      let task =
        apiMode === "api"
          ? await fetchJson<DiagnosisTask>(
              `${apiBaseUrl}/api/incidents/${incidentId}/diagnosis-tasks`,
              { method: "POST" },
              token
            )
          : await diagnoseIncident(incidentId);

      setDiagnosisTask(task);
      setConsoleData((current) => ({
        ...current,
        diagnosisTasks: [task, ...current.diagnosisTasks.filter((item) => item.id !== task.id)]
      }));

      if (apiMode === "api") {
        task = await pollDiagnosisTask(task.id);
        setDiagnosisTask(task);
        setConsoleData((current) => ({
          ...current,
          diagnosisTasks: [task, ...current.diagnosisTasks.filter((item) => item.id !== task.id)]
        }));
      }

      setErrorMessage(null);
    } catch {
      const task = await diagnoseIncident(incidentId);
      setDiagnosisTask(task);
      setConsoleData((current) => ({
        ...current,
        diagnosisTasks: [task, ...current.diagnosisTasks.filter((item) => item.id !== task.id)]
      }));
      setApiMode("local");
      setErrorMessage("诊断接口调用失败，已切换到本地 Agent mock 结果。");
    } finally {
      setLoadingDiagnosis(false);
    }
  };

  const pollDiagnosisTask = async (taskId: string): Promise<DiagnosisTask> => {
    for (let count = 0; count < 60; count += 1) {
      await wait(500);
      const task = await fetchJson<DiagnosisTask>(`${apiBaseUrl}/api/diagnosis-tasks/${taskId}`, {}, token);
      setDiagnosisTask(task);

      if (task.status === "completed" || task.status === "failed") {
        return task;
      }
    }

    throw new Error("诊断任务等待超时");
  };

  const generateRollbackPlan = () => {
    if (!diagnosisTask) {
      setRollbackPlan(["请先完成一次 Agent 诊断，再生成回滚预案。"]);
      return;
    }

    setRollbackPlan([
      `确认影响服务：${selectedService.name}，当前故障等级为${severityLabel[selectedIncident.severity]}。`,
      "通知业务、研发、测试和值班负责人，冻结相关服务的新发布。",
      "保留当前日志、指标和 Agent 诊断证据，避免回滚后丢失现场。",
      diagnosisTask.diagnosis?.rollbackAdvice ?? "当前诊断尚未完成，暂不生成回滚判断。",
      "按灰度批次回滚最近一次发布，并持续观察错误率、延迟和核心链路成功率。",
      "回滚后补充复盘记录，沉淀监控阈值、降级策略和自动化检查项。"
    ]);
  };

  const copyCliCommand = async () => {
    const command = `npm run cli -- diagnose ${selectedIncident.id}`;

    try {
      await navigator.clipboard.writeText(command);
      setCopyState("已复制 CLI 命令");
    } catch {
      setCopyState(command);
    }

    window.setTimeout(() => setCopyState("复制 CLI 诊断命令"), 1800);
  };

  React.useEffect(() => {
    void loadConsole(token);
  }, [token]);

  React.useEffect(() => {
    if (loadingConsole || !currentUser) {
      return;
    }

    void runDiagnosis(selectedIncidentId);
  }, [selectedIncidentId, apiMode, loadingConsole, currentUser]);

  if (!currentUser) {
    return (
      <main className="loginPage">
        <section className="loginHero" aria-label="AIOps Sentinel 登录">
          <div className="loginBrand">
            <ShieldCheck size={34} />
            <span>AIOps Sentinel</span>
          </div>
          <h1>智能运维故障诊断平台</h1>
          <p>面向生产故障的日志分析、指标研判、Agent 诊断和回滚预案工作台。</p>
          <div className="loginMetrics">
            <span>5 个 MCP 工具</span>
            <span>DeepSeek 实时诊断</span>
            <span>SQLite 任务留痕</span>
          </div>
        </section>

        <section className="loginPanel" aria-label="登录表单">
          <form onSubmit={login}>
            <p className="eyebrow">演示账号</p>
            <h2>登录控制台</h2>
            <label htmlFor="username">账号</label>
            <input
              id="username"
              autoComplete="username"
              value={loginForm.username}
              onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
            />
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={loginForm.password}
              onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
            />
            {loginError && <p className="formError" role="alert">{loginError}</p>}
            {errorMessage && <p className="formHint">{errorMessage}</p>}
            <button className="primary" disabled={loggingIn}>
              <ShieldCheck size={18} />
              {loggingIn ? "登录中" : "进入控制台"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Activity size={26} />
          <span>AIOps Sentinel</span>
        </div>
        <nav aria-label="主导航">
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
          <span>登录用户</span>
          <strong>{currentUser.name}</strong>
          <small>{currentUser.team} · {currentUser.role}</small>
        </div>
        <div className="runtime">
          <span>数据来源</span>
          <strong>{apiMode === "api" ? "后端 API" : "本地 mock"}</strong>
        </div>
        <div className="runtime">
          <span>AI 模式</span>
          <strong>{aiStatus?.configured ? `${aiStatus.provider} · ${aiStatus.model}` : "Mock 兜底"}</strong>
        </div>
        <button className="logoutButton" onClick={() => void logout()}>
          <LogOut size={17} />
          退出登录
        </button>
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

        <section className="summaryStrip" aria-label="运行概览">
          <div>
            <span>活跃故障</span>
            <strong>{consoleData.incidents.length}</strong>
          </div>
          <div>
            <span>严重告警</span>
            <strong>{criticalCount}</strong>
          </div>
          <div>
            <span>最新错误率</span>
            <strong>{latestMetric ? `${latestMetric.errorRate}%` : "--"}</strong>
          </div>
          <div>
            <span>历史诊断</span>
            <strong>{diagnosisHistory.length}</strong>
          </div>
        </section>

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

            <article className="panel wide diagnosisPanel">
              <div className="panelHead">
                <h2>Agent 诊断结论</h2>
                <span className="muted">
                  {!diagnosisTask?.diagnosis
                    ? "任务执行中"
                    : diagnosisTask.diagnosis.modelSource === "deepseek"
                      ? "真实 DeepSeek"
                      : "Mock 兜底"}
                </span>
              </div>
              {diagnosisTask ? (
                <div className="diagnosis">
                  <h3>
                    {diagnosisTask.status === "failed"
                      ? (diagnosisTask.errorMessage ?? "诊断任务执行失败")
                      : (diagnosisTask.diagnosis?.rootCause ?? "Agent 正在分析日志、指标和依赖证据...")}
                  </h3>
                  <p>{diagnosisTask.diagnosis?.impact ?? "诊断任务已创建，系统正在等待模型返回结论。"}</p>
                  <p>{diagnosisTask.diagnosis?.recommendation ?? "请稍候，完成后会自动展示处置建议。"}</p>
                  <div className="confidence">
                    <span>置信度</span>
                    <strong>{Math.round((diagnosisTask.diagnosis?.confidence ?? 0) * 100)}%</strong>
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
                {diagnosisTask?.diagnosis?.evidence.map((item) => (
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
              <button onClick={generateRollbackPlan}>
                <RotateCcw size={16} />
                生成回滚预案
              </button>
              <button onClick={() => void copyCliCommand()}>
                <Terminal size={16} />
                {copyState}
              </button>
              {rollbackPlan.length > 0 && (
                <ol className="rollbackPlan">
                  {rollbackPlan.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              )}
            </article>

            <article className="panel wide">
              <div className="panelHead">
                <h2>历史诊断</h2>
                <span className="muted">{diagnosisHistory.length} 条记录</span>
              </div>
              <div className="history">
                {diagnosisHistory.length > 0 ? (
                  diagnosisHistory.slice(0, 4).map((task) => (
                    <button key={task.id} onClick={() => setDiagnosisTask(task)}>
                      <strong>{new Date(task.completedAt).toLocaleString("zh-CN")}</strong>
                      <span>
                        {task.status === "completed" ? "已完成" : task.status === "failed" ? "失败" : "执行中"} ·{" "}
                        {task.steps.length} 个步骤 · {task.totalDurationMs}ms · 置信度{" "}
                        {Math.round((task.diagnosis?.confidence ?? 0) * 100)}%
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="muted">暂无历史诊断记录，点击“重新诊断”后会自动保存。</p>
                )}
              </div>
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
