#!/usr/bin/env node
import dotenv from "dotenv";
import { diagnoseIncident, listIncidents, logs, services } from "@aiops-sentinel/core";

dotenv.config();

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
        await diagnoseIncident(argument, {
          deepseekApiKey: process.env.DEEPSEEK_API_KEY,
          deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
          deepseekModel: process.env.DEEPSEEK_MODEL
        })
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
        const diagnosis = await diagnoseIncident(argument, {
          deepseekApiKey: process.env.DEEPSEEK_API_KEY,
          deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
          deepseekModel: process.env.DEEPSEEK_MODEL
        });
        console.log(`# Incident Report: ${argument}`);
        console.log(`Root cause: ${diagnosis.rootCause}`);
        console.log(`Impact: ${diagnosis.impact}`);
        console.log(`Recommendation: ${diagnosis.recommendation}`);
        console.log(`Rollback: ${diagnosis.rollbackAdvice}`);
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
