import type { Diagnosis, EvidenceItem, Incident } from "./types";

type DeepSeekConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export const buildMockDiagnosis = (incident: Incident, evidence: EvidenceItem[]): Diagnosis => ({
  incidentId: incident.id,
  modelSource: "mock",
  rootCause:
    incident.serviceId === "svc-order"
      ? "本次下单失败大概率由 order-service 最新发布后支付服务超时向主链路扩散导致。"
      : "本次延迟问题大概率与登录链路中的 Redis token 查询变慢有关。",
  confidence: incident.severity === "critical" ? 0.84 : 0.72,
  impact:
    incident.severity === "critical"
      ? "到达支付确认环节的用户下单成功率下降，核心交易链路受到影响。"
      : "登录功能仍然可用，但移动端用户会明显感知认证变慢。",
  recommendation:
    incident.severity === "critical"
      ? "建议先开启支付超时降级，降低重试放大效应，同步通知业务负责人，并准备回滚最近一次 order-service 发布。"
      : "建议检查 Redis 延迟和连接池占用情况，必要时临时扩容 token 查询缓存。",
  rollbackAdvice:
    incident.severity === "critical"
      ? "如果错误率继续 5 分钟保持在 10% 以上，建议执行灰度回滚。"
      : "在确认基础设施压力前，不建议立即回滚业务代码。",
  evidence
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

const normalizeDiagnosis = (value: Partial<Diagnosis>, incident: Incident, evidence: EvidenceItem[]): Diagnosis => ({
  incidentId: incident.id,
  modelSource: "deepseek",
  rootCause: value.rootCause || "DeepSeek 已返回结果，但缺少明确根因字段。",
  confidence: typeof value.confidence === "number" ? Math.min(Math.max(value.confidence, 0), 1) : 0.6,
  impact: value.impact || "DeepSeek 未返回明确影响范围。",
  recommendation: value.recommendation || "建议结合日志、指标和依赖链路继续排查。",
  rollbackAdvice: value.rollbackAdvice || "当前证据不足，暂不建议直接回滚。",
  evidence: Array.isArray(value.evidence) && value.evidence.length > 0 ? value.evidence : evidence
});

export const requestDeepSeekDiagnosis = async (
  config: DeepSeekConfig,
  incident: Incident,
  evidence: EvidenceItem[]
): Promise<Diagnosis> => {
  if (!config.apiKey) {
    return buildMockDiagnosis(incident, evidence);
  }

  const response = await fetch(`${config.baseUrl ?? "https://api.deepseek.com"}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model ?? "deepseek-chat",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "你是一个 AIOps 故障诊断 Agent。只返回严格 JSON，不要输出 Markdown。字段包含 incidentId、rootCause、confidence、impact、recommendation、rollbackAdvice、evidence。confidence 必须是 0 到 1 的数字。除字段名外，字段内容使用中文。"
        },
        {
          role: "user",
          content: JSON.stringify({ incident, evidence })
        }
      ]
    })
  });

  if (!response.ok) {
    return buildMockDiagnosis(incident, evidence);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    return buildMockDiagnosis(incident, evidence);
  }

  try {
    return normalizeDiagnosis(JSON.parse(extractJson(content)) as Partial<Diagnosis>, incident, evidence);
  } catch {
    return buildMockDiagnosis(incident, evidence);
  }
};
