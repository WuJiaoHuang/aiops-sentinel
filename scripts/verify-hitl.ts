import crypto from "node:crypto";
import { diagnoseIncident, resumeDiagnosisFromCheckpoint } from "../packages/core/src/agent";
import { initializeDatabase, repository } from "../apps/api/src/database";
import type { ApprovalDecision, AuditEvent } from "../packages/core/src/types";

initializeDatabase();
process.env.TARGET_SERVICE_NAME = "demo-service";
process.env.METRICS_PROVIDER = "mock";
process.env.LOG_PROVIDER = "mock";
process.env.HEALTH_PROVIDER = "mock";

const actor = {
  id: "verify-hitl",
  name: "verify-hitl",
  role: "admin" as const,
  team: "automation"
};

const audit = (action: AuditEvent["action"], taskId: string, detail: string) => {
  repository.saveAuditEvent({
    id: crypto.randomUUID(),
    action,
    actorId: actor.id,
    actorName: actor.name,
    target: taskId,
    detail,
    createdAt: new Date().toISOString()
  });
};

const saveWaitingTask = async () => {
  const waiting = await diagnoseIncident("inc-20260824-001", {
    maxSteps: 8,
    allowFallback: true
  });

  if (waiting.status !== "WAITING_FOR_APPROVAL" || !waiting.checkpoint || !waiting.pendingActionProposal) {
    throw new Error("Expected WAITING_FOR_APPROVAL task with persisted checkpoint");
  }

  repository.saveDiagnosisTask(waiting);
  audit("action_proposed", waiting.id, waiting.pendingActionProposal.action);
  audit("approval_requested", waiting.id, waiting.pendingActionProposal.reason);
  const persisted = repository.diagnosisTask(waiting.id);

  if (!persisted?.checkpoint) {
    throw new Error("Checkpoint was not persisted");
  }

  return { waiting, checkpointPersisted: Boolean(persisted.checkpoint) };
};

const approveCase = await saveWaitingTask();
const approveDecision: ApprovalDecision = {
  status: "APPROVED",
  comment: "approved by verify-hitl",
  actor: actor.name,
  decidedAt: new Date().toISOString()
};
audit("approval_approved", approveCase.waiting.id, approveDecision.comment);
const approved = await resumeDiagnosisFromCheckpoint(approveCase.waiting.checkpoint!, approveDecision, { allowFallback: true });
repository.saveDiagnosisTask({ ...approved, id: approveCase.waiting.id, status: "COMPLETED" });
audit("agent_resumed", approveCase.waiting.id, "approved resume completed");

if (!approved.steps.some((item) => item.type === "APPROVED") || !approved.steps.some((item) => item.type === "RESUMED")) {
  throw new Error("Approved trace does not include APPROVED and RESUMED");
}

const rejectCase = await saveWaitingTask();
const rejectDecision: ApprovalDecision = {
  status: "REJECTED",
  comment: "rollback not allowed",
  actor: actor.name,
  decidedAt: new Date().toISOString()
};
audit("approval_rejected", rejectCase.waiting.id, rejectDecision.comment);
const rejected = await resumeDiagnosisFromCheckpoint(rejectCase.waiting.checkpoint!, rejectDecision, { allowFallback: true });
repository.saveDiagnosisTask({ ...rejected, id: rejectCase.waiting.id, status: "REJECTED" });
audit("agent_resumed", rejectCase.waiting.id, "rejected resume completed");

if (!rejected.steps.some((item) => item.type === "REJECTED") || !rejected.steps.some((item) => item.type === "RESUMED")) {
  throw new Error("Rejected trace does not include REJECTED and RESUMED");
}

const latestAudit = repository.auditEvents();
for (const action of ["action_proposed", "approval_requested", "approval_approved", "approval_rejected", "agent_resumed"]) {
  if (!latestAudit.some((item) => item.action === action)) {
    throw new Error(`Audit does not include ${action}`);
  }
}

console.log(JSON.stringify({
  approve: {
    waitingStatus: approveCase.waiting.status,
    finalStatus: "COMPLETED",
    checkpointPersisted: approveCase.checkpointPersisted,
    traceEvents: approved.steps.map((item) => item.type).filter((item) => ["ACTION_PROPOSAL", "WAITING_APPROVAL", "APPROVED", "RESUMED", "FINAL"].includes(item))
  },
  reject: {
    waitingStatus: rejectCase.waiting.status,
    finalStatus: "REJECTED",
    checkpointPersisted: rejectCase.checkpointPersisted,
    traceEvents: rejected.steps.map((item) => item.type).filter((item) => ["ACTION_PROPOSAL", "WAITING_APPROVAL", "REJECTED", "RESUMED", "FINAL"].includes(item))
  },
  auditActions: latestAudit.map((item) => item.action).slice(0, 10)
}, null, 2));
