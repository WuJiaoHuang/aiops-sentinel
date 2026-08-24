import type { Diagnosis, EvidenceItem, Incident } from "./types";

type DeepSeekConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export const buildMockDiagnosis = (incident: Incident, evidence: EvidenceItem[]): Diagnosis => ({
  incidentId: incident.id,
  rootCause:
    incident.serviceId === "svc-order"
      ? "The checkout failure is most likely caused by payment provider timeout propagation after the latest order-service release."
      : "The latency issue is most likely related to slow Redis token lookup on the auth path.",
  confidence: incident.severity === "critical" ? 0.84 : 0.72,
  impact:
    incident.severity === "critical"
      ? "Checkout success rate is degraded for users reaching payment confirmation."
      : "Login requests remain available but mobile users may experience slow authentication.",
  recommendation:
    incident.severity === "critical"
      ? "Enable payment timeout fallback, reduce retry fan-out, notify business owners, and prepare rollback for the latest order-service deployment."
      : "Inspect Redis latency, verify connection pool saturation, and temporarily raise cache capacity for token lookups.",
  rollbackAdvice:
    incident.severity === "critical"
      ? "Rollback is recommended if error rate stays above 10% for another 5 minutes."
      : "Rollback is not recommended before confirming infrastructure pressure.",
  evidence
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
            "You are an AIOps incident diagnosis agent. Return strict JSON with incidentId, rootCause, confidence, impact, recommendation, rollbackAdvice, evidence."
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
    return JSON.parse(content) as Diagnosis;
  } catch {
    return buildMockDiagnosis(incident, evidence);
  }
};
