import crypto from "node:crypto";
import { buildMockDiagnosis, normalizeDiagnosis, requestAgentDecision, requestDeepSeekDiagnosis } from "./deepseek";
import { createMcpToolRuntime } from "./mcpClient";
import { getIncident, getToolDefinition, toolCatalog } from "./tools";
import type { AgentDecision, DeepSeekConfig } from "./deepseek";
import type {
  ActionProposal,
  AgentCheckpoint,
  AgentRun,
  AgentState,
  AgentStep,
  ApprovalDecision,
  Diagnosis,
  DiagnosisTask,
  EvidenceItem,
  Incident,
  LogEntry,
  MetricPoint,
  ModelSource,
  ToolName,
  ToolResult
} from "./types";

export type AgentConfig = DeepSeekConfig & {
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  maxSteps?: number;
};

type RuntimeResult = {
  task: DiagnosisTask;
  state: AgentState;
  modelSource: ModelSource;
  fallbackUsed: boolean;
};

const now = () => new Date().toISOString();

const stableInput = (input: Record<string, unknown>) =>
  JSON.stringify(Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right))));

const hasSameToolCall = (state: AgentState, toolName: ToolName, input: Record<string, unknown>) => {
  const nextKey = stableInput(input);
  return state.toolCalls.some((call) => call.toolName === toolName && stableInput(call.input) === nextKey);
};

const addMessage = (state: AgentState, role: AgentState["messages"][number]["role"], content: string) => {
  state.messages.push({ role, content, timestamp: now() });
};

const step = (steps: AgentStep[], input: Omit<AgentStep, "id" | "stepIndex" | "timestamp">): AgentStep => ({
  ...input,
  id: `step-${steps.length + 1}-${crypto.randomUUID()}`,
  stepIndex: steps.length + 1,
  timestamp: now()
});

const summarizeToolData = (toolName: ToolName, result: ToolResult): string => {
  if (!result.success) {
    if (toolName === "service_health") {
      const payload = result.data as { provider?: string; health?: { service?: string; status?: string } } | null;
      return `provider=${payload?.provider ?? result.provider ?? result.source}；服务 ${payload?.health?.service ?? "unknown"} 健康状态 ${payload?.health?.status ?? "unknown"}；${result.error ?? "未知错误"}`;
    }
    return `${toolName} 调用失败：${result.error ?? "未知错误"}`;
  }

  switch (toolName) {
    case "incident_summary": {
      const incident = result.data as Incident | undefined;
      return incident ? `故障 ${incident.title}，等级 ${incident.severity}，状态 ${incident.status}` : "未找到故障上下文";
    }
    case "service_health": {
      const payload = result.data as { health?: { service?: string; status?: string; components?: Record<string, unknown> }; status?: string; signals?: string[] } | null;
      const health = payload?.health;
      const signals = payload?.signals?.join("；") ?? JSON.stringify(health?.components ?? {});
      return `provider=${result.provider ?? result.source}；服务 ${health?.service ?? "unknown"} 健康状态 ${health?.status ?? payload?.status ?? "unknown"}；${signals}`;
    }
    case "metric_query": {
      if (Array.isArray(result.data)) {
        const points = result.data as MetricPoint[];
        const latest = points.at(-1);
        return latest
          ? `provider=${result.provider ?? result.source}；最新 P99 ${latest.latencyMs}ms，错误率 ${latest.errorRate}%，CPU ${latest.cpu}%`
          : "暂无指标数据";
      }

      const metricResult = result.data as { provider?: string; series?: Array<{ metricName: string; points: Array<{ value: number }> }> } | null;
      const series = metricResult?.series ?? [];
      const latestValues = series
        .map((item) => `${item.metricName}=${item.points.at(-1)?.value ?? "NA"}`)
        .join("；");
      return `provider=${metricResult?.provider ?? result.provider ?? result.source}；${latestValues || "暂无指标数据"}`;
    }
    case "log_search": {
      const matchedLogs = Array.isArray(result.data)
        ? (result.data as LogEntry[])
        : (((result.data as { entries?: LogEntry[] } | null)?.entries ?? []) as LogEntry[]);
      return matchedLogs.length > 0
        ? `provider=${result.provider ?? result.source}；命中 ${matchedLogs.length} 条日志：${matchedLogs.map((log) => log.message).join("；")}`
        : `provider=${result.provider ?? result.source}；没有命中异常日志`;
    }
    case "dependency_trace": {
      const trace = result.data as { provider?: string; dependencies?: Array<{ name: string; type?: string }> } | null;
      return `provider=${trace?.provider ?? result.provider ?? result.source}；依赖服务：${trace?.dependencies?.map((service) => `${service.name}${service.type ? `(${service.type})` : ""}`).join("、") || "无"}`;
    }
    case "knowledge_search": {
      const knowledge = (result.data ?? []) as Array<{ title: string; path?: string; score?: number; snippet?: string }>;
      return knowledge.length > 0
        ? `召回 ${knowledge.length} 条 Runbook：${knowledge.map((item) => `${item.title}${item.score !== undefined ? ` score=${item.score}` : ""}`).join("、")}`
        : "没有召回处置知识";
    }
    case "rollback_advisor": {
      const advice = result.data as { advice?: string; requiresApproval?: boolean; riskLevel?: string } | null;
      return `${advice?.advice ?? "没有回滚建议"}${advice?.requiresApproval ? `；风险 ${advice.riskLevel ?? "UNKNOWN"}；需要人工确认` : ""}`;
    }
  }
};

const evidenceFromToolResult = (toolName: ToolName, result: ToolResult): EvidenceItem => ({
  source: toolName,
  title: result.success ? getToolDefinition(toolName).description : `${toolName} 调用失败`,
  detail: summarizeToolData(toolName, result),
  confidence: result.success ? 0.68 : 0.25
});

const latestErrorRate = (state: AgentState) => {
  const metricCall = [...state.toolCalls].reverse().find((call) => call.toolName === "metric_query" && call.result?.success);
  if (Array.isArray(metricCall?.result?.data)) {
    const points = (metricCall.result.data ?? []) as MetricPoint[];
    return points.at(-1)?.errorRate ?? 0;
  }

  const metricResult = metricCall?.result?.data as { series?: Array<{ metricName: string; points: Array<{ value: number }> }> } | null;
  const errorRateSeries = metricResult?.series?.find((series) => series.metricName === "http_error_rate");
  return errorRateSeries?.points.at(-1)?.value ?? 0;
};

const dependencyNamesFromEvidence = (state: AgentState) => {
  const dependencyCall = [...state.toolCalls].reverse().find((call) => call.toolName === "dependency_trace" && call.result?.success);
  const trace = dependencyCall?.result?.data as { dependencies?: Array<{ name: string; type?: string }> } | null;
  return (trace?.dependencies ?? []).filter((item) => item.type !== "infrastructure").map((item) => item.name);
};

const logMentionedService = (state: AgentState) => {
  const logCall = [...state.toolCalls].reverse().find((call) => call.toolName === "log_search" && call.result?.success);
  const logs = Array.isArray(logCall?.result?.data)
    ? (logCall?.result?.data as LogEntry[])
    : (((logCall?.result?.data as { entries?: LogEntry[] } | null)?.entries ?? []) as LogEntry[]);
  const text = logs.map((log) => log.message).join("\n");
  const match = text.match(/\b([a-z][a-z0-9-]*-service)\b/i);
  return match?.[1];
};

const fallbackDecision = (state: AgentState): AgentDecision => {
  const called = new Set(state.toolCalls.map((call) => call.toolName));
  const serviceId = state.incident.serviceId;
  const target = process.env.TARGET_SERVICE_NAME ?? "demo-service";
  const discoveredService = logMentionedService(state) ?? dependencyNamesFromEvidence(state)[0];
  const hasDependencyEvidence = called.has("dependency_trace");
  const hasLogs = called.has("log_search");
  const hasHealthForDiscovered = discoveredService
    ? state.toolCalls.some((call) => call.toolName === "service_health" && (call.input.service === discoveredService || call.input.serviceId === discoveredService))
    : false;

  const choose = (toolName: ToolName, reason: string, input: Record<string, unknown>): AgentDecision => ({
    type: "TOOL",
    toolName,
    toolInput: input,
    reason,
    hypothesis: state.currentHypothesis || "正在基于告警上下文逐步收集证据",
    confidence: Math.max(state.confidence, 0.45)
  });

  if (!called.has("incident_summary")) {
    return choose("incident_summary", "先读取 Incident 基础上下文", { incidentId: state.incident.id });
  }

  if (!called.has("metric_query")) {
    return choose("metric_query", "先确认受影响服务的指标窗口", { target, service: serviceId, serviceId, metric: "http_error_rate", timeRangeMinutes: 15 });
  }

  if (!hasLogs) {
    return choose("log_search", "查询受影响服务日志，寻找错误、超时或下游名称", { target, service: serviceId, serviceId, level: "warn", keyword: "timeout", limit: 20 });
  }

  if (!hasDependencyEvidence) {
    return choose("dependency_trace", "查询静态依赖拓扑，确认日志中出现的下游是否属于真实依赖", { target, service: serviceId, serviceId });
  }

  if (discoveredService && !hasHealthForDiscovered) {
    return choose("service_health", "对已由日志或依赖拓扑发现的下游服务执行健康检查", { target, service: discoveredService, serviceId: discoveredService });
  }

  if (!called.has("knowledge_search")) {
    return choose("knowledge_search", "检索 Runbook，为处置建议补充知识证据", {
      target,
      service: serviceId,
      serviceId,
      query: `${state.currentHypothesis} ${state.incident.summary}`,
      keyword: discoveredService ?? "timeout"
    });
  }

  if (state.incident.severity === "critical" && !called.has("rollback_advisor")) {
    return choose("rollback_advisor", "严重故障需要生成高风险处置建议，但不自动执行", {
      incidentId: state.incident.id,
      errorRate: latestErrorRate(state)
    });
  }

  return {
    type: "FINAL",
    reason: state.confidence >= 0.68 ? "已有证据足够形成诊断结论" : "可用证据不足，输出不确定结论",
    hypothesis: state.currentHypothesis || "基于现有证据输出诊断结论",
    confidence: Math.max(state.confidence, 0.45),
    finalDiagnosis: buildMockDiagnosis(state.incident, state.evidence, state.confidence < 0.68, "fallback")
  };
};

const normalizeDecision = (decision: AgentDecision, state: AgentState): AgentDecision => {
  if (decision.type === "FINAL") {
    return decision;
  }

  if (decision.toolName && toolCatalog.some((tool) => tool.name === decision.toolName)) {
    return {
      ...decision,
      type: "TOOL",
      toolInput: decision.toolInput ?? {},
      confidence: Math.min(Math.max(decision.confidence ?? state.confidence, 0), 1)
    };
  }

  return fallbackDecision(state);
};

const finalDiagnosis = async (
  state: AgentState,
  modelSource: ModelSource,
  llmConfig: DeepSeekConfig,
  decision?: AgentDecision
): Promise<Diagnosis> => {
  if (decision?.finalDiagnosis) {
    return normalizeDiagnosis(decision.finalDiagnosis, state.incident, state.evidence, modelSource);
  }

  if (modelSource === "deepseek") {
    try {
      return await requestDeepSeekDiagnosis(llmConfig, state.incident, state.evidence);
    } catch (error) {
      if (llmConfig.allowFallback === false) {
        throw error;
      }
    }
  }

  return buildMockDiagnosis(state.incident, state.evidence, state.confidence < 0.68, modelSource);
};

const pendingProposal = (diagnosis: Diagnosis) =>
  diagnosis.actionProposals?.find((proposal) => proposal.requiresApproval && proposal.riskLevel !== "LOW");

const makeCheckpoint = (
  state: AgentState,
  steps: AgentStep[],
  runId: string,
  startedAt: string,
  maxSteps: number,
  model: string,
  modelSource: ModelSource,
  fallbackUsed: boolean,
  pendingActionProposal: ActionProposal
): AgentCheckpoint => ({
  version: 1,
  state: {
    ...state,
    pendingActionProposal,
    finalDiagnosis: null
  },
  steps,
  runId,
  startedAt,
  maxSteps,
  model,
  modelSource,
  fallbackUsed,
  pendingActionProposal
});

const buildTask = (
  incidentId: string,
  taskId: string,
  startedAt: Date,
  steps: AgentStep[],
  diagnosis: Diagnosis | null,
  modelSource: ModelSource,
  fallbackUsed: boolean,
  status: DiagnosisTask["status"],
  checkpoint?: AgentCheckpoint,
  approvalDecision?: ApprovalDecision
): DiagnosisTask => {
  const completedAt = status === "WAITING_FOR_APPROVAL" ? "" : now();
  const totalDurationMs = (completedAt ? new Date(completedAt).getTime() : Date.now()) - startedAt.getTime();
  const runStatus: AgentRun["status"] =
    status === "WAITING_FOR_APPROVAL"
      ? "waiting_for_approval"
      : status === "APPROVED"
        ? "approved"
        : status === "REJECTED"
          ? "rejected"
          : status === "FAILED"
            ? "failed"
            : "completed";
  const agentRun: AgentRun = {
    runId: checkpoint?.runId ?? `run-${incidentId}-${startedAt.getTime()}`,
    incidentId,
    model: checkpoint?.model ?? "deepseek-chat",
    status: runStatus,
    startTime: startedAt.toISOString(),
    endTime: completedAt,
    totalLatency: totalDurationMs,
    totalToolCalls: checkpoint?.state.toolCalls.length ?? 0,
    finalDiagnosis: diagnosis,
    confidence: diagnosis?.confidence ?? checkpoint?.state.confidence ?? 0,
    steps,
    modelSource,
    fallbackUsed
  };

  return {
    id: taskId,
    incidentId,
    status,
    startedAt: startedAt.toISOString(),
    completedAt,
    totalDurationMs,
    steps,
    diagnosis,
    agentRun,
    checkpoint,
    pendingActionProposal: checkpoint?.pendingActionProposal,
    approvalDecision
  };
};

const toDeepSeekConfig = (config: AgentConfig): DeepSeekConfig => ({
  apiKey: config.apiKey ?? config.deepseekApiKey,
  baseUrl: config.baseUrl ?? config.deepseekBaseUrl,
  model: config.model ?? config.deepseekModel,
  timeoutMs: config.timeoutMs,
  maxRetries: config.maxRetries,
  allowFallback: config.allowFallback ?? true
});

const runAgent = async (
  incident: Incident,
  config: AgentConfig,
  existing?: {
    state: AgentState;
    steps: AgentStep[];
    runId: string;
    startedAt: Date;
    modelSource: ModelSource;
    fallbackUsed: boolean;
  }
): Promise<RuntimeResult> => {
  const startedAt = existing?.startedAt ?? new Date();
  const runId = existing?.runId ?? `run-${incident.id}-${startedAt.getTime()}`;
  const taskId = `task-${incident.id}-${startedAt.getTime()}`;
  const maxSteps = config.maxSteps ?? 8;
  const llmConfig = toDeepSeekConfig(config);
  const model = llmConfig.model ?? "deepseek-chat";
  const state: AgentState =
    existing?.state ?? {
      messages: [],
      incident,
      evidence: [],
      toolCalls: [],
      currentHypothesis: "",
      confidence: 0,
      stepCount: 0,
      finalDiagnosis: null
    };
  const steps = existing?.steps ?? [];
  let modelSource = existing?.modelSource ?? (llmConfig.apiKey ? "deepseek" : "fallback");
  let fallbackUsed = existing?.fallbackUsed ?? false;
  const runtime = await createMcpToolRuntime({ toolTimeoutMs: Number(process.env.AIOPS_TOOL_TIMEOUT_MS ?? 5000) });

  if (!existing) {
    addMessage(state, "system", "动态 Tool Calling Agent 已启动，所有工具调用必须经由 MCP Client。");
    addMessage(state, "user", JSON.stringify({ incident, availableTools: toolCatalog }));
  }

  try {
    while (state.stepCount < maxSteps && !state.finalDiagnosis) {
      const llmStartedAt = Date.now();
      let decision: AgentDecision;

      try {
        decision = normalizeDecision(await requestAgentDecision(llmConfig, state), state);
        modelSource = "deepseek";
      } catch (error) {
        if (llmConfig.allowFallback === false) {
          throw error;
        }

        decision = fallbackDecision(state);
        modelSource = "fallback";
        fallbackUsed = true;
        steps.push(
          step(steps, {
            type: "ERROR",
            title: "LLM 决策失败，启用本地 fallback",
            description: "DeepSeek 调用失败后没有中断 Agent，转为基于已有状态的通用规则决策。",
            toolName: "agent_runtime",
            toolOutput: { error: error instanceof Error ? error.message : "LLM 决策失败" },
            status: "completed",
            latency: Date.now() - llmStartedAt,
            summary: decision.reason
          })
        );
      }

      state.currentHypothesis = decision.hypothesis || state.currentHypothesis;
      state.confidence = Math.max(state.confidence, decision.confidence ?? 0);
      addMessage(state, "assistant", JSON.stringify(decision));
      steps.push(
        step(steps, {
          type: "LLM",
          title: decision.type === "TOOL" ? `LLM 判断需要调用 ${decision.toolName}` : "LLM 判断可以结束诊断",
          description: decision.reason,
          toolName: "agent_runtime",
          toolInput: {
            hypothesis: state.currentHypothesis,
            confidence: state.confidence,
            evidenceCount: state.evidence.length
          },
          toolOutput: decision as Record<string, unknown>,
          status: "completed",
          latency: Date.now() - llmStartedAt,
          summary: decision.reason
        })
      );

      if (decision.type === "FINAL") {
        state.finalDiagnosis = await finalDiagnosis(state, modelSource, llmConfig, decision);
        break;
      }

      const toolName = decision.toolName;
      const toolInput = decision.toolInput ?? {};

      if (!toolName) {
        state.finalDiagnosis = buildMockDiagnosis(incident, state.evidence, true, modelSource);
        break;
      }

      if (hasSameToolCall(state, toolName, toolInput)) {
        const duplicateMessage = `跳过重复 Tool Call：${toolName} ${stableInput(toolInput)}`;
        addMessage(state, "tool", duplicateMessage);
        steps.push(
          step(steps, {
            type: "ERROR",
            title: "重复工具调用已去重",
            description: "Agent 检测到工具名和参数完全一致，避免浪费调用并防止循环。",
            toolName,
            toolInput,
            status: "skipped",
            latency: 0,
            summary: duplicateMessage
          })
        );
        state.stepCount += 1;
        continue;
      }

      const toolStartedAt = Date.now();
      const toolDefinition = getToolDefinition(toolName);
      const result = await runtime.callTool(toolName, toolInput, { incidentId: incident.id, serviceId: incident.serviceId });
      const toolRecord = {
        toolName,
        mcpName: toolDefinition.mcpName,
        input: toolInput,
        result,
        timestamp: now()
      };
      state.toolCalls.push(toolRecord);
      state.evidence.push(evidenceFromToolResult(toolName, result));
      addMessage(state, "tool", JSON.stringify(toolRecord));
      steps.push(
        step(steps, {
          type: result.success ? "TOOL" : "ERROR",
          title: `调用 MCP Tool：${toolDefinition.mcpName}`,
          description: toolDefinition.description,
          toolName,
          toolInput,
          toolOutput: result,
          status: result.success ? "completed" : "failed",
          latency: Date.now() - toolStartedAt,
          summary: summarizeToolData(toolName, result)
        })
      );

      state.stepCount += 1;
    }

    if (!state.finalDiagnosis) {
      state.finalDiagnosis = await finalDiagnosis(state, modelSource, llmConfig);
    }

    const proposal = !state.approvalDecision ? pendingProposal(state.finalDiagnosis) : undefined;
    if (proposal) {
      steps.push(
        step(steps, {
          type: "ACTION_PROPOSAL",
          title: "生成高风险 ActionProposal",
          description: proposal.reason,
          toolName: "agent_runtime",
          toolOutput: proposal,
          status: "completed",
          latency: 0,
          summary: `${proposal.action} 需要人工审批`
        })
      );
      steps.push(
        step(steps, {
          type: "WAITING_APPROVAL",
          title: "等待人工审批",
          description: "高风险动作不会自动执行，任务已保存 checkpoint 并等待 approve 或 reject。",
          toolName: "agent_runtime",
          toolOutput: { pendingActionProposal: proposal },
          status: "completed",
          latency: 0,
          summary: "WAITING_FOR_APPROVAL"
        })
      );
      const checkpoint = makeCheckpoint(state, steps, runId, startedAt.toISOString(), maxSteps, model, modelSource, fallbackUsed, proposal);
      return {
        task: buildTask(incident.id, taskId, startedAt, steps, null, modelSource, fallbackUsed, "WAITING_FOR_APPROVAL", checkpoint),
        state,
        modelSource,
        fallbackUsed
      };
    }

    if (state.approvalDecision?.status === "REJECTED" && state.finalDiagnosis) {
      state.finalDiagnosis = {
        ...state.finalDiagnosis,
        actionProposals: [],
        recommendation: `${state.finalDiagnosis.recommendation} 人工拒绝高风险动作后，建议继续执行低风险排查、扩容观察和降级保护。`
      };
    }

    steps.push(
      step(steps, {
        type: "FINAL",
        title: state.finalDiagnosis.uncertain ? "输出不确定诊断" : "生成最终诊断",
        description: "Agent 根据当前证据、假设、审批上下文和置信度终止本次运行。",
        toolName: "agent_runtime",
        toolOutput: state.finalDiagnosis,
        status: "completed",
        latency: 0,
        summary: state.finalDiagnosis.rootCause
      })
    );
  } finally {
    await runtime.close();
  }

  return {
    task: buildTask(incident.id, taskId, startedAt, steps, state.finalDiagnosis, modelSource, fallbackUsed, "COMPLETED"),
    state,
    modelSource,
    fallbackUsed
  };
};

export const diagnoseIncident = async (incidentId: string, config: AgentConfig = {}): Promise<DiagnosisTask> => {
  const incident = getIncident(incidentId);
  if (!incident) {
    throw new Error(`未找到故障 ${incidentId}`);
  }

  return (await runAgent(incident, { ...config, allowFallback: config.allowFallback ?? true })).task;
};

export const resumeDiagnosisFromCheckpoint = async (
  checkpoint: AgentCheckpoint,
  approvalDecision: ApprovalDecision,
  config: AgentConfig = {}
): Promise<DiagnosisTask> => {
  const state: AgentState = {
    ...checkpoint.state,
    pendingActionProposal: checkpoint.pendingActionProposal,
    approvalDecision,
    finalDiagnosis: null
  };
  const steps = [
    ...checkpoint.steps,
    step(checkpoint.steps, {
      type: approvalDecision.status === "APPROVED" ? "APPROVED" : "REJECTED",
      title: approvalDecision.status === "APPROVED" ? "人工已批准建议" : "人工已拒绝建议",
      description: approvalDecision.comment,
      toolName: "agent_runtime",
      toolOutput: approvalDecision,
      status: "completed",
      latency: 0,
      summary: approvalDecision.status
    })
  ];
  steps.push(
    step(steps, {
      type: "RESUMED",
      title: "Agent 从 checkpoint 恢复",
      description: "恢复 messages、evidence、toolCalls、hypothesis、confidence 和 pendingActionProposal。",
      toolName: "agent_runtime",
      toolOutput: {
        evidenceCount: state.evidence.length,
        toolCallCount: state.toolCalls.length,
        approvedAction: checkpoint.pendingActionProposal.action,
        decision: approvalDecision.status
      },
      status: "completed",
      latency: 0,
      summary: "agent_resumed"
    })
  );

  const incident = state.incident;
  const result = await runAgent(incident, { ...config, maxSteps: checkpoint.maxSteps, allowFallback: config.allowFallback ?? true }, {
    state,
    steps,
    runId: checkpoint.runId,
    startedAt: new Date(checkpoint.startedAt),
    modelSource: checkpoint.modelSource,
    fallbackUsed: checkpoint.fallbackUsed
  });

  return {
    ...result.task,
    approvalDecision,
    pendingActionProposal: checkpoint.pendingActionProposal
  };
};
