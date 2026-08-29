import crypto from "node:crypto";
import { buildMockDiagnosis, normalizeDiagnosis, requestAgentDecision } from "./deepseek";
import { createMcpToolRuntime } from "./mcpClient";
import { getIncident, getToolDefinition, toolCatalog } from "./tools";
import type {
  AgentDecision,
  DeepSeekConfig
} from "./deepseek";
import type {
  AgentRun,
  AgentState,
  AgentStep,
  Diagnosis,
  DiagnosisTask,
  EvidenceItem,
  Incident,
  LogEntry,
  MetricPoint,
  ToolName,
  ToolResult
} from "./types";

export type AgentConfig = DeepSeekConfig & {
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  maxSteps?: number;
};

type DynamicSignal = {
  selectedTool?: ToolName;
  final?: boolean;
};

const now = () => new Date().toISOString();

const stableInput = (input: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)))
  );

const hasSameToolCall = (state: AgentState, toolName: ToolName, input: Record<string, unknown>) => {
  const nextKey = stableInput(input);
  return state.toolCalls.some((call) => call.toolName === toolName && stableInput(call.input) === nextKey);
};

const addMessage = (state: AgentState, role: AgentState["messages"][number]["role"], content: string) => {
  state.messages.push({ role, content, timestamp: now() });
};

const summarizeToolData = (toolName: ToolName, result: ToolResult): string => {
  if (!result.success) {
    return `${toolName} 调用失败：${result.error ?? "未知错误"}`;
  }

  switch (toolName) {
    case "incident_summary": {
      const incident = result.data as Incident | undefined;
      return incident ? `故障 ${incident.title}，等级 ${incident.severity}，状态 ${incident.status}` : "未找到故障上下文";
    }
    case "service_health": {
      const health = result.data as { status?: string; signals?: string[] } | null;
      return `服务健康状态 ${health?.status ?? "unknown"}；${health?.signals?.join("；") ?? "暂无信号"}`;
    }
    case "metric_query": {
      const points = (result.data ?? []) as MetricPoint[];
      const latest = points.at(-1);
      return latest
        ? `最新 P99 ${latest.latencyMs}ms，错误率 ${latest.errorRate}%，CPU ${latest.cpu}%`
        : "暂无指标数据";
    }
    case "log_search": {
      const matchedLogs = (result.data ?? []) as LogEntry[];
      return matchedLogs.length > 0
        ? `命中 ${matchedLogs.length} 条日志：${matchedLogs.map((log) => log.message).join("；")}`
        : "没有命中异常日志";
    }
    case "dependency_trace": {
      const trace = result.data as { dependencies?: Array<{ name: string }> } | null;
      return `依赖服务：${trace?.dependencies?.map((service) => service.name).join("、") || "无"}`;
    }
    case "knowledge_search": {
      const knowledge = (result.data ?? []) as Array<{ title: string; content: string }>;
      return knowledge.length > 0
        ? `召回 ${knowledge.length} 条知识：${knowledge.map((item) => item.title).join("、")}`
        : "没有召回处置知识";
    }
    case "rollback_advisor": {
      const advice = result.data as { advice?: string; requiresApproval?: boolean } | null;
      return `${advice?.advice ?? "没有回滚建议"}${advice?.requiresApproval ? "；需要人工确认" : ""}`;
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
  const points = (metricCall?.result?.data ?? []) as MetricPoint[];
  return points.at(-1)?.errorRate ?? 0;
};

const fallbackDecision = (state: AgentState): AgentDecision => {
  const called = new Set(state.toolCalls.map((call) => call.toolName));
  const hasErrorEvidence = state.evidence.some((item) => item.detail.toLowerCase().includes("timeout"));
  const hasCriticalHealth = state.evidence.some((item) => item.detail.includes("critical") || item.detail.includes("错误率"));

  const choose = (selectedTool: ToolName, reason: string, input: Record<string, unknown>): AgentDecision => ({
    type: "TOOL",
    toolName: selectedTool,
    toolInput: input,
    reason,
    hypothesis: state.currentHypothesis || "正在基于告警上下文逐步收集证据",
    confidence: Math.max(state.confidence, 0.45)
  });

  const signal: DynamicSignal =
    !called.has("incident_summary")
      ? { selectedTool: "incident_summary" }
      : !called.has("service_health")
        ? { selectedTool: "service_health" }
        : hasCriticalHealth && !called.has("metric_query")
          ? { selectedTool: "metric_query" }
          : hasCriticalHealth && !called.has("log_search")
            ? { selectedTool: "log_search" }
            : hasErrorEvidence && !called.has("dependency_trace")
              ? { selectedTool: "dependency_trace" }
              : !called.has("knowledge_search")
                ? { selectedTool: "knowledge_search" }
                : state.incident.severity === "critical" && !called.has("rollback_advisor")
                  ? { selectedTool: "rollback_advisor" }
                  : { final: true };

  if (signal.final || !signal.selectedTool) {
    return {
      type: "FINAL",
      reason: state.confidence >= 0.68 ? "已有证据足够形成诊断结论" : "可用证据不足，输出不确定结论",
      hypothesis: state.currentHypothesis || "证据不足，无法确定唯一根因",
      confidence: Math.max(state.confidence, 0.45),
      finalDiagnosis: buildMockDiagnosis(state.incident, state.evidence, state.confidence < 0.68)
    };
  }

  const serviceId = state.incident.serviceId;
  const inputByTool: Record<ToolName, Record<string, unknown>> = {
    incident_summary: { incidentId: state.incident.id },
    service_health: { serviceId },
    metric_query: { serviceId },
    log_search: { serviceId, level: "error" },
    dependency_trace: { serviceId },
    knowledge_search: { serviceId, query: state.currentHypothesis || state.incident.title },
    rollback_advisor: { incidentId: state.incident.id, errorRate: latestErrorRate(state) }
  };

  return choose(signal.selectedTool, `本地兜底策略选择 ${signal.selectedTool}`, inputByTool[signal.selectedTool]);
};

const normalizeDecision = (decision: AgentDecision, state: AgentState): AgentDecision => {
  if (decision.type === "FINAL") {
    return decision;
  }

  const fallback = fallbackDecision(state);
  const toolName = decision.toolName && toolCatalog.some((tool) => tool.name === decision.toolName)
    ? decision.toolName
    : fallback.toolName;

  return {
    ...decision,
    type: "TOOL",
    toolName,
    toolInput: {
      ...(fallback.toolName === toolName ? fallback.toolInput : {}),
      ...(decision.toolInput ?? {})
    },
    confidence: Math.min(Math.max(decision.confidence ?? state.confidence, 0), 1)
  };
};

const makeStep = (
  steps: AgentStep[],
  input: Omit<AgentStep, "id" | "stepIndex" | "timestamp">
): AgentStep => ({
  ...input,
  id: `step-${steps.length + 1}-${crypto.randomUUID()}`,
  stepIndex: steps.length + 1,
  timestamp: now()
});

const finishDiagnosis = (state: AgentState, decision?: AgentDecision): Diagnosis => {
  if (decision?.finalDiagnosis) {
    return normalizeDiagnosis(
      decision.finalDiagnosis,
      state.incident,
      state.evidence,
      decision.finalDiagnosis.modelSource ?? "deepseek"
    );
  }

  return buildMockDiagnosis(state.incident, state.evidence, state.confidence < 0.68);
};

export const diagnoseIncident = async (incidentId: string, config: AgentConfig = {}): Promise<DiagnosisTask> => {
  const startedAt = new Date();
  const runId = `run-${incidentId}-${startedAt.getTime()}`;
  const maxSteps = config.maxSteps ?? 8;
  const llmConfig: DeepSeekConfig = {
    apiKey: config.apiKey ?? config.deepseekApiKey,
    baseUrl: config.baseUrl ?? config.deepseekBaseUrl,
    model: config.model ?? config.deepseekModel,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries
  };
  const incident = getIncident(incidentId);

  if (!incident) {
    throw new Error(`未找到故障 ${incidentId}`);
  }

  const state: AgentState = {
    messages: [],
    incident,
    evidence: [],
    toolCalls: [],
    currentHypothesis: "",
    confidence: 0,
    stepCount: 0,
    finalDiagnosis: null
  };
  const steps: AgentStep[] = [];
  const runtime = await createMcpToolRuntime({ toolTimeoutMs: Number(process.env.AIOPS_TOOL_TIMEOUT_MS ?? 5000) });

  addMessage(state, "system", "动态 Tool Calling Agent 已启动，所有工具调用必须经由 MCP Client。");
  addMessage(state, "user", JSON.stringify({ incident, availableTools: toolCatalog }));

  try {
    while (state.stepCount < maxSteps && !state.finalDiagnosis) {
      const llmStartedAt = Date.now();
      let decision: AgentDecision;

      try {
        decision = normalizeDecision(await requestAgentDecision(llmConfig, state), state);
      } catch (error) {
        decision = fallbackDecision(state);
        steps.push(
          makeStep(steps, {
            type: "ERROR",
            title: "LLM 决策失败，启用本地兜底",
            description: "DeepSeek 调用失败后没有中断 Agent，转为基于已有状态的规则决策。",
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
        makeStep(steps, {
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
        state.finalDiagnosis = finishDiagnosis(state, decision);
        break;
      }

      const toolName = decision.toolName;
      const toolInput = decision.toolInput ?? {};

      if (!toolName) {
        state.finalDiagnosis = buildMockDiagnosis(incident, state.evidence, true);
        break;
      }

      if (hasSameToolCall(state, toolName, toolInput)) {
        const duplicateMessage = `跳过重复 Tool Call：${toolName} ${stableInput(toolInput)}`;
        addMessage(state, "tool", duplicateMessage);
        steps.push(
          makeStep(steps, {
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
      const result = await runtime.callTool(toolName, toolInput, { incidentId, serviceId: incident.serviceId });
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
        makeStep(steps, {
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
      state.finalDiagnosis = buildMockDiagnosis(incident, state.evidence, state.confidence < 0.68);
      steps.push(
        makeStep(steps, {
          type: "FINAL",
          title: "达到最大步数，生成诊断结论",
          description: `Agent 已达到 maxSteps=${maxSteps}，基于现有证据输出结论或不确定判断。`,
          toolName: "agent_runtime",
          toolOutput: state.finalDiagnosis,
          status: "completed",
          latency: 0,
          summary: state.finalDiagnosis.rootCause
        })
      );
    } else {
      steps.push(
        makeStep(steps, {
          type: "FINAL",
          title: state.finalDiagnosis.uncertain ? "输出不确定诊断" : "生成最终诊断",
          description: "Agent 根据当前证据、假设和置信度终止本次运行。",
          toolName: "agent_runtime",
          toolOutput: state.finalDiagnosis,
          status: "completed",
          latency: 0,
          summary: state.finalDiagnosis.rootCause
        })
      );
    }
  } finally {
    await runtime.close();
  }

  const completedAt = new Date();
  const totalDurationMs = completedAt.getTime() - startedAt.getTime();
  const agentRun: AgentRun = {
    runId,
    incidentId,
    model: llmConfig.model ?? "deepseek-chat",
    status: "completed",
    startTime: startedAt.toISOString(),
    endTime: completedAt.toISOString(),
    totalLatency: totalDurationMs,
    totalToolCalls: state.toolCalls.length,
    finalDiagnosis: state.finalDiagnosis,
    confidence: state.finalDiagnosis?.confidence ?? state.confidence,
    steps
  };

  return {
    id: `task-${incidentId}-${startedAt.getTime()}`,
    incidentId,
    status: "completed",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    totalDurationMs,
    steps,
    diagnosis: state.finalDiagnosis,
    agentRun
  };
};
