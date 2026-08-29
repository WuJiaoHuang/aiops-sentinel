#!/usr/bin/env node
import { listIncidents, logs, services } from "@aiops-sentinel/core";
import { diagnoseIncident } from "@aiops-sentinel/core/agent";
import { loadRootEnv } from "./env";

loadRootEnv();

const [, , command, argument] = process.argv;

const print = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2));
};

const main = async () => {
  switch (command) {
    case "scan":
      print({
        services: services.map((service) => ({
          id: service.id,
          name: service.name,
          owner: service.owner,
          dependencies: service.dependencies.length
        })),
        openIncidents: listIncidents().filter((incident) => incident.status !== "resolved")
      });
      break;
    case "diagnose":
      if (!argument) {
        throw new Error("Usage: sentinel diagnose <incidentId>");
      }
      print(
        ((await diagnoseIncident(argument, {
          deepseekApiKey: process.env.DEEPSEEK_API_KEY,
          deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
          deepseekModel: process.env.DEEPSEEK_MODEL
        })).diagnosis ?? { message: "诊断任务尚未完成" })
      );
      break;
    case "logs":
      if (!argument) {
        throw new Error("Usage: sentinel logs <serviceId>");
      }
      print(logs.filter((log) => log.serviceId === argument));
      break;
    case "report":
      if (!argument) {
        throw new Error("Usage: sentinel report <incidentId>");
      }
      {
        const task = await diagnoseIncident(argument, {
          deepseekApiKey: process.env.DEEPSEEK_API_KEY,
          deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
          deepseekModel: process.env.DEEPSEEK_MODEL
        });
        const diagnosis = task.diagnosis;
        if (!diagnosis) {
          throw new Error("诊断任务尚未完成，无法生成报告");
        }
        console.log(`# 故障报告：${argument}`);
        console.log(`根因判断：${diagnosis.rootCause}`);
        console.log(`影响范围：${diagnosis.impact}`);
        console.log(`处置建议：${diagnosis.recommendation}`);
        console.log(`回滚建议：${diagnosis.rollbackAdvice}`);
        console.log(`Agent 步骤数：${task.steps.length}`);
      }
      break;
    default:
      console.log("AIOps Sentinel CLI");
      console.log("Commands: scan | diagnose <incidentId> | logs <serviceId> | report <incidentId>");
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
