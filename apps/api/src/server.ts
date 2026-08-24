import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { diagnoseIncident, tools } from "@aiops-sentinel/core";
import { initializeDatabase, repository } from "./database";

dotenv.config();
initializeDatabase();

const app = express();
const port = Number(process.env.PORT ?? 8787);

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
      modelSource: task.diagnosis.modelSource,
      message:
        task.diagnosis.modelSource === "deepseek"
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
  response.json(repository.diagnosisTasks(incidentId));
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
