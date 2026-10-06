// Agrupa etiquetas libres equivalentes ("¿cuánto cuesta?" → "Precio / inversión",
// "precio del curso" → idem). El modelo SOLO decide qué etiquetas son la misma
// cosa; los conteos se hacen después en código. Si la respuesta no es válida
// (una etiqueta sin grupo, una inventada), se descarta y cada etiqueta queda
// como su propio grupo.

import { callJson } from "./llm";
import { ClusterResponseSchema } from "./schema";
import type { LabelMap } from "./aggregate";
import { toLabelMap } from "./group-map";

const key = (s: string) => s.trim().toLocaleLowerCase("es");

const SYSTEM = `Agrupas etiquetas cortas que significan lo mismo. Devuelves SOLO JSON: {"groups":[{"name":"nombre del grupo","members":["etiqueta exacta", "..."]}]}
Reglas:
- Cada etiqueta de entrada aparece exactamente en UN grupo, copiada tal cual.
- No inventes etiquetas ni dejes ninguna fuera.
- Une solo lo que es realmente la misma intención; si dudas, deja grupos separados.
- "name": nombre claro en español, corto (puede ser una de las etiquetas).`;

export async function clusterLabels(params: {
  workspaceId: string;
  kind: string;
  labels: string[];
}): Promise<LabelMap> {
  const unique = [...new Map(params.labels.map((l) => [key(l), l.trim()])).values()].filter(Boolean);
  if (unique.length <= 1) return new Map();
  // Volúmenes enormes: se agrupa lo más frecuente y el resto queda como está.
  const capped = unique.slice(0, 300);
  try {
    const { data } = await callJson({
      schema: ClusterResponseSchema,
      system: SYSTEM,
      user: `Tipo de etiquetas: ${params.kind}\n\nEtiquetas:\n${capped.map((l) => `- ${l}`).join("\n")}`,
      workspaceId: params.workspaceId,
      maxOutputTokens: 4000,
    });
    return toLabelMap(capped, data.groups) ?? new Map();
  } catch (error: unknown) {
    console.error("[insights] cluster failed:", params.kind, error instanceof Error ? error.message : "unknown");
    return new Map();
  }
}
