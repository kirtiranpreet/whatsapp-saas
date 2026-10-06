// Resumen y recomendaciones del informe. El modelo solo ve los AGREGADOS (no
// las conversaciones completas) y cada recomendación debe citar las claves de
// datos que la originan ("faq:precio / inversión", "objection:precio"…). Las
// que no citan datos reales se descartan.

import type { ReportStats } from "./aggregate";
import { keepGrounded, statsDigest, type Recommendation } from "./grounding";
import { callJson } from "./llm";
import { RecommendationResponseSchema, RECOMMENDATION_TYPES } from "./schema";

export type { Recommendation } from "./grounding";

const SYSTEM = `Eres consultora comercial. Recibes los datos agregados de las conversaciones de WhatsApp que atendió un agente de ventas durante un periodo. Devuelves SOLO JSON:
{"summary":"...","recommendations":[{"type":"${RECOMMENDATION_TYPES.join("|")}","title":"...","problem":"problema detectado","action":"acción concreta sugerida","impact":"impacto potencial, prudente","based_on":["clave", "..."]}]}

Reglas:
- Usa SOLO los datos recibidos. No inventes cifras, problemas ni frases.
- "based_on": las claves exactas (entre corchetes en los datos) que justifican la recomendación. Al menos una.
- Separa dato de interpretación: "el precio aparece en el 40 % de las conversaciones no convertidas" es un dato; "no compran por el precio" es una interpretación que NO debes afirmar.
- No afirmes causalidad. Habla de "aparece", "se repite", "coincide".
- Si la muestra es pequeña, dilo en el resumen y sé prudente.
- "summary": 4-6 frases en español, directas, para la dueña del negocio.
- Máximo 6 recomendaciones, ordenadas por importancia.`;

export async function recommend(params: {
  workspaceId: string;
  stats: ReportStats;
}): Promise<{ summary: string; recommendations: Recommendation[] }> {
  if (params.stats.totals.analyzed === 0) {
    return { summary: "No hubo conversaciones atendidas por el agente en este periodo.", recommendations: [] };
  }
  const { data } = await callJson({
    schema: RecommendationResponseSchema,
    system: SYSTEM,
    user: statsDigest(params.stats),
    workspaceId: params.workspaceId,
    maxOutputTokens: 3000,
  });
  return { summary: data.summary, recommendations: keepGrounded(data.recommendations, params.stats) };
}
