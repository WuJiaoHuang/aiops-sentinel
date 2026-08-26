import cors from "cors";
import express from "express";
import { diagnoseIncident, tools } from "@aiops-sentinel/core";
import type { DiagnosisTask } from "@aiops-sentinel/core";
import { initializeDatabase, repository } from "./database";
import { loadRootEnv } from "./env";

loadRootEnv();
initializeDatabase();

const app = express();
const port = Number(process.env.PORT ?? 8787);
const runningTasks = new Map<string, DiagnosisTask>();

app.use(cors());
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "aiops-sentinel-api" });
});

app.get("/api/ai/status", (_request, response) => {
  response.json({
    provider: "DeepSeek",
    configured: Boolean(process.env.DEEPSEEK_API_KEY),
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    fallback: "未配置或调用失败时自动使用本地 mock 诊断"
  });
});

app.post("/api/ai/test", async (_request, response) => {
  try {
    const task = await diagnoseIncident("inc-20260824-001", {
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
      deepseekModel: process.env.DEEPSEEK_MODEL
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

app.get("/api/services", (_request, response) => {
  response.json(repository.services());
});

app.get("/api/incidents", (_request, response) => {
  response.json(repository.incidents());
});

app.get("/api/console", (_request, response) => {
  response.json({
    services: repository.services(),
    incidents: repository.incidents(),
    logs: repository.logs(),
    metrics: repository.metrics(),
    diagnosisTasks: repository.diagnosisTasks()
  });
});

app.get("/api/logs", (request, response) => {
  const serviceId = String(request.query.serviceId ?? "");
  response.json(repository.logs(serviceId || undefined));
});

app.get("/api/metrics/:serviceId", (request, response) => {
  response.json(repository.metrics()[request.params.serviceId] ?? []);
});

app.get("/api/diagnosis-tasks", (request, response) => {
  const incidentId = request.query.incidentId ? String(request.query.incidentId) : undefined;
  const persistedTasks = repository.diagnosisTasks(incidentId);
  const activeTasks = Array.from(runningTasks.values()).filter((task) =>
    incidentId ? task.incidentId === incidentId : true
  );

  response.json([...activeTasks, ...persistedTasks]);
});

app.get("/api/diagnosis-tasks/:taskId", (request, response) => {
  const runningTask = runningTasks.get(request.params.taskId);
  const persistedTask = repository.diagnosisTask(request.params.taskId);
  const task = runningTask ?? persistedTask;

  if (!task) {
    response.status(404).json({ message: "诊断任务不存在" });
    return;
  }

  response.json(task);
});

app.post("/api/tools/:toolName", (request, response) => {
  const toolName = request.params.toolName as keyof typeof tools;
  const tool = tools[toolName];

  if (!tool) {
    response.status(404).json({ message: `Tool ${toolName} was not found` });
    return;
  }

  const result = tool(request.body.input ?? {}, request.body.context ?? {});
  response.json(result);
});

app.post("/api/incidents/:incidentId/diagnosis-tasks", (request, response) => {
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
        title: "创建诊断任务",
        description: "后端已接收故障诊断请求，正在调度 Agent 工作流。",
        tool: "diagnosis_task_queue",
        status: "completed",
        durationMs: 0,
        summary: "任务已进入执行队列"
      }
    ],
    diagnosis: null
  };

  runningTasks.set(task.id, task);
  response.status(202).json(task);

  windowlessRunDiagnosis(task.id, request.params.incidentId);
});

app.post("/api/incidents/:incidentId/diagnose", async (request, response) => {
  try {
    const task = await diagnoseIncident(request.params.incidentId, {
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
      deepseekModel: process.env.DEEPSEEK_MODEL
    });
    repository.saveDiagnosisTask(task);

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
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
      deepseekModel: process.env.DEEPSEEK_MODEL
    })
      .then((completedTask) => {
        const task = {
          ...completedTask,
          id: taskId
        };
        repository.saveDiagnosisTask(task);
        runningTasks.delete(taskId);
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
