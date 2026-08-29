import type { AgentState, Diagnosis, EvidenceItem, Incident, ToolName } from "./types";

export type DeepSeekConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
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

export const buildMockDiagnosis = (incident: Incident, evidence: EvidenceItem[], uncertain = false): Diagnosis => ({
  incidentId: incident.id,
  modelSource: "mock",
  rootCause: uncertain
    ? "当前证据不足，Agent 无法确定唯一根因。"
    : incident.serviceId === "svc-order"
      ? "本次下单失败大概率由 order-service 最新发布后支付服务超时向主链路扩散导致。"
      : "本次延迟问题大概率与登录链路中的 Redis token 查询变慢有关。",
  confidence: uncertain ? 0.45 : incident.severity === "critical" ? 0.84 : 0.72,
  impact:
    incident.severity === "critical"
      ? "到达支付确认环节的用户下单成功率下降，核心交易链路受到影响。"
      : "核心功能仍然可用，但用户会明显感知响应变慢。",
  recommendation: uncertain
    ? "建议继续补充日志、指标、依赖链路和变更记录，暂不执行高风险修复。"
    : incident.severity === "critical"
      ? "建议先开启超时降级，降低重试放大效应，同步通知业务负责人，并准备人工确认后的受控回滚。"
      : "建议检查缓存、数据库或下游依赖延迟，必要时临时扩容热点资源。",
  rollbackAdvice:
    incident.severity === "critical"
      ? "如需回滚，只生成建议，不自动执行；必须由值班负责人确认。"
      : "当前证据不足，不建议立即回滚业务代码。",
  evidence,
  uncertain,
  actionProposals:
    incident.severity === "critical"
      ? [
          {
            action: "rollback version",
            reason: "严重故障且错误率可能超过阈值，回滚属于高风险线上操作。",
            riskLevel: "HIGH",
            evidence: evidence.map((item) => item.title).slice(0, 4),
            requiresApproval: true
          }
        ]
      : []
});

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
  evidence: Array.isArray(value.evidence) && value.evidence.length > 0 ? value.evidence : evidence,
  actionProposals: value.actionProposals ?? [],
  uncertain: value.uncertain ?? false
});

const chatCompletion = async (config: DeepSeekConfig, messages: Array<{ role: string; content: string }>) => {
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

  return content;
};

export const requestAgentDecision = async (config: DeepSeekConfig, state: AgentState): Promise<AgentDecision> => {
  if (!config.apiKey) {
    throw new Error("未配置 DeepSeek API Key");
  }

  const content = await withRetry(
    () =>
      chatCompletion(config, [
        {
          role: "system",
          content:
            "你是 AIOps 动态 Tool Calling Agent。你只能返回严格 JSON。字段：type=TOOL或FINAL，toolName，toolInput，reason，hypothesis，confidence，finalDiagnosis。可用工具：incident_summary、service_health、metric_query、log_search、dependency_trace、knowledge_search、rollback_advisor。证据不足时继续选工具；证据充分或无法继续时输出 FINAL。不要强行确定根因，允许 uncertain=true。高风险动作只能生成 actionProposals，不能自动执行。"
        },
        {
          role: "user",
          content: JSON.stringify({
            incident: state.incident,
            evidence: state.evidence,
            toolCalls: state.toolCalls,
            currentHypothesis: state.currentHypothesis,
            confidence: state.confidence,
            stepCount: state.stepCount
          })
        }
      ]),
    config,
    "DeepSeek Agent Decision"
  );

  const parsed = JSON.parse(extractJson(content)) as AgentDecision;
  return {
    ...parsed,
    confidence: typeof parsed.confidence === "number" ? Math.min(Math.max(parsed.confidence, 0), 1) : 0.5
  };
};

export const requestDeepSeekDiagnosis = async (
  config: DeepSeekConfig,
  incident: Incident,
  evidence: EvidenceItem[]
): Promise<Diagnosis> => {
  if (!config.apiKey) {
    return buildMockDiagnosis(incident, evidence);
  }

  try {
    const content = await withRetry(
      () =>
        chatCompletion(config, [
          {
            role: "system",
            content:
              "你是一个 AIOps 故障诊断 Agent。只返回严格 JSON，不要输出 Markdown。字段包含 incidentId、rootCause、confidence、impact、recommendation、rollbackAdvice、evidence、actionProposals、uncertain。confidence 必须是 0 到 1 的数字。涉及 restart service、rollback version、modify configuration 的动作必须放入 actionProposals，MEDIUM/HIGH requiresApproval=true，不得声称已执行。除字段名外，字段内容使用中文。"
          },
          {
            role: "user",
            content: JSON.stringify({ incident, evidence })
          }
        ]),
      config,
      "DeepSeek Final Diagnosis"
    );

    return normalizeDiagnosis(JSON.parse(extractJson(content)) as Partial<Diagnosis>, incident, evidence);
  } catch {
    return buildMockDiagnosis(incident, evidence, evidence.length < 2);
  }
};
