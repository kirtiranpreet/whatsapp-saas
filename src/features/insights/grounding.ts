// Partes puras de las recomendaciones: el resumen de datos que ve el modelo y
// el filtro que descarta recomendaciones sin datos reales detrás.

import { statKeys, type ReportStats } from "./aggregate";
import type { RECOMMENDATION_TYPES } from "./constants";

export interface Recommendation {
  type: (typeof RECOMMENDATION_TYPES)[number];
  title: string;
  problem: string;
  action: string;
  impact: string;
  based_on: string[];
}

const SMALL_SAMPLE = 10;

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
