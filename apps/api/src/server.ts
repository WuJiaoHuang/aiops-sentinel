import cors from "cors";
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import express from "express";
import { toolCatalog, tools } from "@aiops-sentinel/core/tools";
import { diagnoseIncident, resumeDiagnosisFromCheckpoint } from "@aiops-sentinel/core/agent";
import type { ApprovalDecision, AuditAction, CurrentUser, DiagnosisTask } from "@aiops-sentinel/core";
import { initializeDatabase, repository } from "./database";
import { loadRootEnv } from "./env";

loadRootEnv();
initializeDatabase();

const app = express();
const port = Number(process.env.PORT ?? 8787);
const runningTasks = new Map<string, DiagnosisTask>();
const sessions = new Map<string, CurrentUser>();
const demoUser: CurrentUser = {
  id: "u-platform-admin",
  name: "吴同学",
  role: "admin",
  team: "平台工程组"
};
const demoAccount = {
  username: process.env.DEMO_USERNAME ?? "admin",
  password: process.env.DEMO_PASSWORD ?? "aiops2026"
};

app.use(cors());
app.use(express.json());

const getBearerToken = (request: Request) => {
  const authorization = request.headers.authorization ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
};

const requireAuth = (request: Request, response: Response, next: NextFunction) => {
  const user = sessions.get(getBearerToken(request));

  if (!user) {
    response.status(401).json({ message: "请先登录后再访问运维控制台" });
    return;
  }

  response.locals.user = user;
  next();
};

const writeAuditEvent = (action: AuditAction, actor: CurrentUser, target: string, detail: string) => {
  repository.saveAuditEvent({
    id: crypto.randomUUID(),
    action,
    actorId: actor.id,
    actorName: actor.name,
    target,
    detail,
    createdAt: new Date().toISOString()
  });
};

const agentConfig = () => ({
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
  deepseekModel: process.env.DEEPSEEK_MODEL,
  allowFallback: process.env.AIOPS_ALLOW_FALLBACK === "false" ? false : true
});

const saveTaskAndAuditHitl = (task: DiagnosisTask, actor: CurrentUser) => {
  repository.saveDiagnosisTask(task);

  if (task.status === "WAITING_FOR_APPROVAL" && task.pendingActionProposal) {
    writeAuditEvent(
      "action_proposed",
      actor,
      task.id,
      `${task.pendingActionProposal.action} risk=${task.pendingActionProposal.riskLevel}`
    );
    writeAuditEvent(
      "approval_requested",
      actor,
      task.id,
      `等待人工审批：${task.pendingActionProposal.reason}`
    );
  }
};

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "aiops-sentinel-api" });
});

app.post("/api/auth/login", (request, response) => {
  const { username, password } = request.body as { username?: string; password?: string };

  if (username !== demoAccount.username || password !== demoAccount.password) {
    response.status(401).json({ message: "账号或密码错误" });
    return;
  }

  const token = crypto.randomUUID();
  sessions.set(token, demoUser);
  writeAuditEvent("login", demoUser, "auth", "登录智能运维控制台");

  response.json({ token, user: demoUser });
});

app.get("/api/auth/me", requireAuth, (_request, response) => {
  response.json(response.locals.user as CurrentUser);
});

app.post("/api/auth/logout", requireAuth, (request, response) => {
  writeAuditEvent("logout", response.locals.user as CurrentUser, "auth", "退出智能运维控制台");
  sessions.delete(getBearerToken(request));
  response.json({ ok: true });
});

app.get("/api/ai/status", (_request, response) => {
  response.json({
    provider: "DeepSeek",
    configured: Boolean(process.env.DEEPSEEK_API_KEY),
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    fallback: "未配置或调用失败时自动使用本地 mock 诊断",
    agentRuntime: "planner + MCP stdio server + MCP client tool calls + RAG knowledge search",
    mcpTransport: "stdio",
    tools: toolCatalog
  });
});

app.post("/api/ai/test", async (_request, response) => {
  try {
    const task = await diagnoseIncident("inc-20260824-001", {
      ...agentConfig()
    });

    response.json({
      ok: true,
      modelSource: task.diagnosis?.modelSource ?? "mock",
      message:
        task.diagnosis?.modelSource === "deepseek"
          ? "DeepSeek 调用成功，当前诊断结果来自真实模型。"
          : "当前使用 mock 诊断，可能是未配置 API Key 或模型调用失败。",
      diagnosis: task.diagnosis
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "DeepSeek 测试失败"
    });
  }
});

app.get("/api/services", requireAuth, (_request, response) => {
  response.json(repository.services());
});

app.get("/api/incidents", requireAuth, (_request, response) => {
  response.json(repository.incidents());
});

app.get("/api/console", requireAuth, (_request, response) => {
  writeAuditEvent("view_console", response.locals.user as CurrentUser, "console", "查看生产故障控制台");
  response.json({
    services: repository.services(),
    incidents: repository.incidents(),
    logs: repository.logs(),
    metrics: repository.metrics(),
    diagnosisTasks: repository.diagnosisTasks(),
    auditEvents: repository.auditEvents()
  });
});

app.get("/api/audit-events", requireAuth, (_request, response) => {
  response.json(repository.auditEvents());
});

app.get("/api/logs", requireAuth, (request, response) => {
  const serviceId = String(request.query.serviceId ?? "");
  response.json(repository.logs(serviceId || undefined));
});

app.get("/api/metrics/:serviceId", requireAuth, (request, response) => {
  response.json(repository.metrics()[request.params.serviceId] ?? []);
});

app.get("/api/tools", requireAuth, (_request, response) => {
  response.json(toolCatalog);
});

app.get("/api/diagnosis-tasks", requireAuth, (request, response) => {
  const incidentId = request.query.incidentId ? String(request.query.incidentId) : undefined;
  const persistedTasks = repository.diagnosisTasks(incidentId);
  const activeTasks = Array.from(runningTasks.values()).filter((task) =>
    incidentId ? task.incidentId === incidentId : true
  );

  response.json([...activeTasks, ...persistedTasks]);
});

app.get("/api/diagnosis-tasks/:taskId", requireAuth, (request, response) => {
  const runningTask = runningTasks.get(request.params.taskId);
  const persistedTask = repository.diagnosisTask(request.params.taskId);
  const task = runningTask ?? persistedTask;

  if (!task) {
    response.status(404).json({ message: "诊断任务不存在" });
    return;
  }

  response.json(task);
});

app.post("/api/diagnosis-tasks/:taskId/approve", requireAuth, async (request, response) => {
  const task = runningTasks.get(request.params.taskId) ?? repository.diagnosisTask(request.params.taskId);
  const actor = response.locals.user as CurrentUser;

  if (!task) {
    response.status(404).json({ message: "诊断任务不存在" });
    return;
  }

  if (task.status !== "WAITING_FOR_APPROVAL" || !task.checkpoint) {
    response.status(409).json({ message: "只有 WAITING_FOR_APPROVAL 状态的任务可以审批" });
    return;
  }

  const approvalDecision: ApprovalDecision = {
    status: "APPROVED",
    comment: typeof request.body?.comment === "string" ? request.body.comment : "approved by operator",
    actor: actor.name,
    decidedAt: new Date().toISOString()
  };
  writeAuditEvent(
    "approval_approved",
    actor,
    task.id,
    `risk=${task.pendingActionProposal?.riskLevel ?? "UNKNOWN"}；${approvalDecision.comment}`
  );

  const resumed = await resumeDiagnosisFromCheckpoint(task.checkpoint, approvalDecision, agentConfig());
  const completedTask = {
    ...resumed,
    id: task.id,
    status: "COMPLETED" as const
  };
  writeAuditEvent("agent_resumed", actor, task.id, "Agent 已基于 approve checkpoint 恢复并结束诊断");
  repository.saveDiagnosisTask(completedTask);
  runningTasks.delete(task.id);
  response.json(completedTask);
});

app.post("/api/diagnosis-tasks/:taskId/reject", requireAuth, async (request, response) => {
  const task = runningTasks.get(request.params.taskId) ?? repository.diagnosisTask(request.params.taskId);
  const actor = response.locals.user as CurrentUser;

  if (!task) {
    response.status(404).json({ message: "诊断任务不存在" });
    return;
  }

  if (task.status !== "WAITING_FOR_APPROVAL" || !task.checkpoint) {
    response.status(409).json({ message: "只有 WAITING_FOR_APPROVAL 状态的任务可以拒绝" });
    return;
  }

  const approvalDecision: ApprovalDecision = {
    status: "REJECTED",
    comment: typeof request.body?.comment === "string" ? request.body.comment : "rejected by operator",
    actor: actor.name,
    decidedAt: new Date().toISOString()
  };
  writeAuditEvent(
    "approval_rejected",
    actor,
    task.id,
    `risk=${task.pendingActionProposal?.riskLevel ?? "UNKNOWN"}；${approvalDecision.comment}`
  );

  const resumed = await resumeDiagnosisFromCheckpoint(task.checkpoint, approvalDecision, agentConfig());
  const rejectedTask = {
    ...resumed,
    id: task.id,
    status: "REJECTED" as const
  };
  writeAuditEvent("agent_resumed", actor, task.id, "Agent 已基于 reject checkpoint 恢复并结束诊断");
  repository.saveDiagnosisTask(rejectedTask);
  runningTasks.delete(task.id);
  response.json(rejectedTask);
});

app.post("/api/tools/:toolName", requireAuth, (request, response) => {
  const toolName = request.params.toolName as keyof typeof tools;
  const tool = tools[toolName];

  if (!tool) {
    response.status(404).json({ message: `Tool ${toolName} was not found` });
    return;
  }

  void Promise.resolve(tool.execute(request.body.input ?? {}, request.body.context ?? {})).then((result) =>
    response.json(result)
  );
});

app.post("/api/incidents/:incidentId/diagnosis-tasks", requireAuth, (request, response) => {
  const startedAt = new Date();
  const task: DiagnosisTask = {
    id: `task-${request.params.incidentId}-${startedAt.getTime()}`,
    incidentId: request.params.incidentId,
    status: "running",
    startedAt: startedAt.toISOString(),
    completedAt: "",
    totalDurationMs: 0,
    steps: [
      {
        id: "step-task-created",
        stepIndex: 1,
        type: "TOOL",
        title: "创建诊断任务",
        description: "后端已接收故障诊断请求，正在调度 Agent 工作流。",
        toolName: "diagnosis_task_queue",
        status: "completed",
        latency: 0,
        timestamp: startedAt.toISOString(),
        summary: "任务已进入执行队列"
      }
    ],
    diagnosis: null
  };

  runningTasks.set(task.id, task);
  writeAuditEvent(
    "create_diagnosis_task",
    response.locals.user as CurrentUser,
    request.params.incidentId,
    "创建异步 Agent 故障诊断任务"
  );
  response.status(202).json(task);

  windowlessRunDiagnosis(task.id, request.params.incidentId);
});

app.post("/api/incidents/:incidentId/diagnose", requireAuth, async (request, response) => {
  try {
    const task = await diagnoseIncident(request.params.incidentId, {
      ...agentConfig()
    });
    saveTaskAndAuditHitl(task, response.locals.user as CurrentUser);

    response.json(task);
  } catch (error) {
    response.status(404).json({ message: error instanceof Error ? error.message : "诊断失败" });
  }
});

app.listen(port, () => {
  console.log(`AIOps Sentinel API listening on http://localhost:${port}`);
});

const windowlessRunDiagnosis = (taskId: string, incidentId: string) => {
  globalThis.setTimeout(() => {
    void diagnoseIncident(incidentId, {
      ...agentConfig()
    })
      .then((completedTask) => {
        const task = {
          ...completedTask,
          id: taskId
        };
        saveTaskAndAuditHitl(task, demoUser);
        if (task.status === "WAITING_FOR_APPROVAL") {
          runningTasks.set(taskId, task);
        } else {
          runningTasks.delete(taskId);
        }
      })
      .catch((error) => {
        const runningTask = runningTasks.get(taskId);
        const failedTask: DiagnosisTask = {
          ...(runningTask ?? {
            id: taskId,
            incidentId,
            startedAt: new Date().toISOString(),
            steps: [],
            diagnosis: null
          }),
          status: "failed",
          completedAt: new Date().toISOString(),
          totalDurationMs: 0,
          errorMessage: error instanceof Error ? error.message : "诊断任务执行失败"
        };
        runningTasks.set(taskId, failedTask);
      });
  }, 600);
};
