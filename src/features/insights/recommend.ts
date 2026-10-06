// Resumen y recomendaciones del informe. El modelo solo ve los AGREGADOS (no
// las conversaciones completas) y cada recomendación debe citar las claves de
// datos que la originan ("faq:precio / inversión", "objection:precio"…). Las
// que no citan datos reales se descartan.

import { statKeys, type ReportStats } from "./aggregate";
import { callJson } from "./llm";
import { RecommendationResponseSchema, RECOMMENDATION_TYPES } from "./schema";

export interface Recommendation {
  type: (typeof RECOMMENDATION_TYPES)[number];
  title: string;
  problem: string;
  action: string;
  impact: string;
  based_on: string[];
}

const SMALL_SAMPLE = 10;

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

function rowLine(r: { key: string; name: string; occurrences: number; conversations: number; percent: number; examples: { quote: string }[] }): string {
  const ex = r.examples
    .slice(0, 2)
    .map((e) => `"${e.quote.slice(0, 160)}"`)
    .join(" | ");
  return `[${r.key}] ${r.name}: ${r.conversations} conversaciones (${r.percent} %), ${r.occurrences} veces${ex ? ` — ej.: ${ex}` : ""}`;
}

export function statsDigest(stats: ReportStats): string {
  const t = stats.totals;
  const out: string[] = [];
  out.push(`Conversaciones analizadas: ${t.analyzed} (no convertidas: ${t.not_purchased}).`);
  if (t.analyzed < SMALL_SAMPLE) out.push(`ATENCIÓN: muestra pequeña (${t.analyzed}).`);
  out.push("\nRESULTADOS:");
  for (const o of stats.outcomes) if (o.count) out.push(`[${o.key}] ${o.status}: ${o.count} (${o.percent} %)`);
  out.push("\nINTENCIÓN:");
  for (const i of stats.intent) out.push(`[${i.key}] ${i.level}: ${i.count} (${i.percent} %)`);
  out.push("\nPREGUNTAS FRECUENTES:");
  for (const r of stats.faq.slice(0, 12)) out.push(rowLine(r));
  out.push("\nOBJECIONES:");
  for (const r of stats.objections.slice(0, 10)) out.push(rowLine(r));
  out.push("\nMOTIVOS DE COMPRA:");
  for (const r of stats.motivations.slice(0, 8)) out.push(rowLine(r));
  out.push(`\nMOTIVOS DE NO COMPRA (porcentaje sobre ${t.not_purchased} no convertidas):`);
  for (const r of stats.non_buying.slice(0, 8)) out.push(`${rowLine(r)}; inferidos: ${r.inferred}`);
  out.push("\nTEMAS:");
  for (const r of stats.topics.slice(0, 10)) out.push(rowLine(r));
  return out.join("\n");
}

/** Deja solo recomendaciones con al menos una clave de datos real. */
export function keepGrounded(recs: Recommendation[], stats: ReportStats): Recommendation[] {
  const valid = statKeys(stats);
  return recs
    .map((r) => ({ ...r, based_on: r.based_on.filter((k) => valid.has(k)) }))
    .filter((r) => r.based_on.length > 0);
}

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
