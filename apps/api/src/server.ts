import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { diagnoseIncident, listIncidents, logs, metrics, services, tools } from "@aiops-sentinel/core";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(cors());
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "aiops-sentinel-api" });
});

app.get("/api/services", (_request, response) => {
  response.json(services);
});

app.get("/api/incidents", (_request, response) => {
  response.json(listIncidents());
});

app.get("/api/logs", (request, response) => {
  const serviceId = String(request.query.serviceId ?? "");
  response.json(serviceId ? logs.filter((log) => log.serviceId === serviceId) : logs);
});

app.get("/api/metrics/:serviceId", (request, response) => {
  response.json(metrics[request.params.serviceId] ?? []);
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
    const diagnosis = await diagnoseIncident(request.params.incidentId, {
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
      deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
      deepseekModel: process.env.DEEPSEEK_MODEL
    });

    response.json(diagnosis);
  } catch (error) {
    response.status(404).json({ message: error instanceof Error ? error.message : "Diagnosis failed" });
  }
});

app.listen(port, () => {
  console.log(`AIOps Sentinel API listening on http://localhost:${port}`);
});
