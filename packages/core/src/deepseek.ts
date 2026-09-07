import type { AgentState, Diagnosis, EvidenceItem, Incident, ModelSource, ToolName } from "./types";

export type DeepSeekConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  allowFallback?: boolean;
};

export type AgentDecision = {
  type: "TOOL" | "FINAL";
  toolName?: ToolName;
  toolInput?: Record<string, unknown>;
  reason: string;
  hypothesis: string;
  confidence: number;
  finalDiagnosis?: Partial<Diagnosis>;
};

export type DeepSeekVerificationResult = {
  model: string;
  httpStatus: number;
  content: string;
};

const wait = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时：${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const withRetry = async <T>(operation: () => Promise<T>, config: DeepSeekConfig, label: string): Promise<T> => {
  const maxRetries = config.maxRetries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await withTimeout(operation(), config.timeoutMs ?? 8000, label);
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        await wait(200 * 2 ** attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} 调用失败`);
};

const evidenceTextOf = (evidence: EvidenceItem[]) => evidence.map((item) => item.detail).join("\n").toLowerCase();

const extractSuspectedDownstream = (evidenceText: string) => {
  const healthDown = evidenceText.match(/服务\s+([a-z0-9_-]+)\s+健康状态\s+down/i);
  if (healthDown?.[1]) {
    return healthDown[1];
  }

  const failedCall = evidenceText.match(/([a-z0-9_-]+)\s+call failed/i);
  if (failedCall?.[1]) {
    return failedCall[1];
  }

  return "";
};

export const buildMockDiagnosis = (
  incident: Incident,
  evidence: EvidenceItem[],
  uncertain = false,
  modelSource: ModelSource = "fallback"
): Diagnosis => {
  const evidenceText = evidenceTextOf(evidence);
  const suspectedDownstream = extractSuspectedDownstream(evidenceText);
  const hasTimeoutSignal = /timeout|timed out|超时/.test(evidenceText);
  const hasFallbackSignal = /fallback|降级/.test(evidenceText);
  const hasDownSignal = /健康状态\s+down|status["=: ]+down|fetch failed|connection refused|不可达/.test(evidenceText);
  const evidenceEnough = evidence.length >= 2 && (hasTimeoutSignal || hasFallbackSignal || hasDownSignal);
  const resolvedUncertain = uncertain || !evidenceEnough;
  const downstreamPhrase = suspectedDownstream ? `下游依赖 ${suspectedDownstream}` : "某个下游依赖";

  return {
    incidentId: incident.id,
    modelSource,
    rootCause: resolvedUncertain
      ? "当前证据不足，Agent 无法确定唯一根因。"
      : `${incident.serviceId} 受影响，证据显示 ${downstreamPhrase} 存在不可用、超时或降级信号，导致当前业务流程异常。`,
    confidence: resolvedUncertain ? 0.45 : incident.severity === "critical" ? 0.82 : 0.7,
    impact:
      incident.severity === "critical"
        ? "核心链路受到影响，用户请求可能出现失败、超时或降级响应。"
        : "核心功能仍可能可用，但用户会感知响应变慢或部分能力降级。",
    recommendation: resolvedUncertain
      ? "建议继续补充日志、指标、依赖链路和服务健康证据，暂不执行高风险修复。"
      : `先保持降级保护，继续观察 ${incident.serviceId} 的错误率和延迟；针对 ${downstreamPhrase} 做人工确认后的恢复或回滚预案。`,
    rollbackAdvice:
      incident.severity === "critical"
        ? "如需回滚、重启或改配置，只生成建议，不自动执行；必须由值班负责人确认。"
        : "当前证据不足，不建议立即回滚业务代码。",
    evidence,
    uncertain: resolvedUncertain,
    actionProposals:
      incident.severity === "critical"
        ? [
            {
              action: "rollback version",
              reason: "严重故障下可能需要回滚版本，但这是高风险线上操作，必须先人工审批。",
              riskLevel: "HIGH",
              evidence: evidence.map((item) => item.title).slice(0, 4),
              requiresApproval: true
            }
          ]
        : []
  };
};

const extractJson = (content: string) => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return content.slice(firstBrace, lastBrace + 1);
  }

  return content;
};

export const normalizeDiagnosis = (
  value: Partial<Diagnosis>,
  incident: Incident,
  evidence: EvidenceItem[],
  modelSource: Diagnosis["modelSource"] = "deepseek"
): Diagnosis => ({
  incidentId: incident.id,
  modelSource,
  rootCause: value.rootCause || "模型已返回结果，但缺少明确根因字段。",
  confidence: typeof value.confidence === "number" ? Math.min(Math.max(value.confidence, 0), 1) : 0.6,
  impact: value.impact || "模型未返回明确影响范围。",
  recommendation: value.recommendation || "建议结合日志、指标和依赖链路继续排查。",
  rollbackAdvice: value.rollbackAdvice || "当前证据不足，暂不建议直接回滚。",
  evidence: evidence.length > 0 ? evidence : Array.isArray(value.evidence) ? value.evidence : [],
  actionProposals: value.actionProposals ?? [],
  uncertain: value.uncertain ?? false
});

const chatCompletion = async (
  config: DeepSeekConfig,
  messages: Array<{ role: string; content: string }>
): Promise<{ status: number; content: string }> => {
  const response = await fetch(`${config.baseUrl ?? "https://api.deepseek.com"}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model ?? "deepseek-chat",
      temperature: 0.1,
      messages
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek HTTP ${response.status}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("DeepSeek 未返回 content");
  }

  return { status: response.status, content };
};

const ensureDeepSeekKey = (config: DeepSeekConfig) => {
  if (!config.apiKey) {
    throw new Error("未配置 DeepSeek API Key");
  }
};

const validateAgentDecision = (decision: Partial<AgentDecision>): AgentDecision => {
  if (decision.type !== "TOOL" && decision.type !== "FINAL") {
    throw new Error("DeepSeek 输出非法 type");
  }

  if (decision.type === "TOOL") {
    const allowedTools: ToolName[] = [
      "incident_summary",
      "service_health",
      "metric_query",
      "log_search",
      "dependency_trace",
      "knowledge_search",
      "rollback_advisor"
    ];

    if (!decision.toolName || !allowedTools.includes(decision.toolName)) {
      throw new Error("DeepSeek 输出非法 Tool");
    }
  }

  return {
    type: decision.type,
    toolName: decision.toolName,
    toolInput: decision.toolInput ?? {},
    reason: typeof decision.reason === "string" ? decision.reason : "模型未返回 reason",
    hypothesis: typeof decision.hypothesis === "string" ? decision.hypothesis : "",
    confidence: typeof decision.confidence === "number" ? Math.min(Math.max(decision.confidence, 0), 1) : 0.5,
    finalDiagnosis: decision.finalDiagnosis
  };
};

const agentSystemPrompt = [
  "你是 AIOps 动态 Tool Calling Agent。你只能返回严格 JSON。",
  "字段：type=TOOL或FINAL，toolName，toolInput，reason，hypothesis，confidence，finalDiagnosis。",
  "可用工具：incident_summary、metric_query、log_search、dependency_trace、service_health、knowledge_search、rollback_advisor。",
  "严格规则：",
  "1. 不能根据 Incident title 直接猜根因。",
  "2. 不能根据 target/service 名称直接认定某个下游是根因。",
  "3. 根因至少需要 2 个独立 Evidence 支撑。",
  "4. 如果怀疑下游服务，必须通过 dependency_trace 或 log_search 发现依赖名称后，再调用 service_health。",
  "5. Tool 参数必须来自 Incident、当前 Evidence、dependency_trace 或 previous Tool Result。",
  "6. 不得凭空 invent service name。",
  "7. Evidence 不足时必须 uncertain=true。",
  "8. 如果 Tool 失败，要记录失败并尝试其他路径，不要立即终止。",
  "9. 高风险动作只能生成 actionProposals，不能自动执行。"
].join("\n");

export const requestAgentDecision = async (config: DeepSeekConfig, state: AgentState): Promise<AgentDecision> => {
  ensureDeepSeekKey(config);

  const { content } = await withRetry(
    () =>
      chatCompletion(config, [
        {
          role: "system",
          content: agentSystemPrompt
        },
        {
          role: "user",
          content: JSON.stringify({
            incident: state.incident,
            evidence: state.evidence,
            toolCalls: state.toolCalls,
            currentHypothesis: state.currentHypothesis,
            confidence: state.confidence,
            stepCount: state.stepCount,
            pendingActionProposal: state.pendingActionProposal,
            approvalDecision: state.approvalDecision
          })
        }
      ]),
    config,
    "DeepSeek Agent Decision"
  );

  return validateAgentDecision(JSON.parse(extractJson(content)) as Partial<AgentDecision>);
};

export const requestDeepSeekDiagnosis = async (
  config: DeepSeekConfig,
  incident: Incident,
  evidence: EvidenceItem[]
): Promise<Diagnosis> => {
  ensureDeepSeekKey(config);

  const { content } = await withRetry(
    () =>
      chatCompletion(config, [
        {
          role: "system",
          content:
            "你是一个 AIOps 故障诊断 Agent。只返回严格 JSON，不要输出 Markdown。字段包含 incidentId、rootCause、confidence、impact、recommendation、rollbackAdvice、evidence、actionProposals、uncertain。confidence 必须是 0 到 1 的数字。根因至少需要两个独立 Evidence。涉及 restart service、rollback version、modify configuration 的动作必须放入 actionProposals，MEDIUM/HIGH requiresApproval=true，不得声称已执行。除字段名外，字段内容使用中文。"
        },
        {
          role: "user",
          content: JSON.stringify({ incident, evidence })
        }
      ]),
    config,
    "DeepSeek Final Diagnosis"
  );

  return normalizeDiagnosis(JSON.parse(extractJson(content)) as Partial<Diagnosis>, incident, evidence, "deepseek");
};

export const verifyDeepSeekOnline = async (config: DeepSeekConfig): Promise<DeepSeekVerificationResult> => {
  ensureDeepSeekKey(config);
  const model = config.model ?? "deepseek-chat";
  const { status, content } = await withRetry(
    () =>
      chatCompletion(config, [
        {
          role: "system",
          content: "Return strict JSON only."
        },
        {
          role: "user",
          content: "{\"ping\":\"deepseek verification\"}"
        }
      ]),
    { ...config, maxRetries: config.maxRetries ?? 0 },
    "DeepSeek Verification"
  );

  return {
    model,
    httpStatus: status,
    content
  };
};
