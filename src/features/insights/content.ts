// "Convierte tus conversaciones en contenido": desde una pregunta frecuente,
// una objeción, un motivo de no compra o un tema del lenguaje del cliente de
// un informe, genera hooks, Reels, carrusel, email, respuesta de WhatsApp,
// idea de masterclass y FAQ. Solo con las frases reales de ese grupo.

import type { ReportStats } from "./aggregate";
import { callJson } from "./llm";
import { ContentResponseSchema, type ContentPack } from "./schema";

export type ContentSourceKind = "faq" | "objection" | "non_buying" | "motivation" | "language";

export interface ContentSource {
  kind: ContentSourceKind;
  key: string;
  name: string;
  quotes: string[];
  conversations: number;
  percent: number | null;
}

/** Busca el grupo en el informe y recoge sus citas literales. */
export function resolveSource(stats: ReportStats, kind: ContentSourceKind, key: string): ContentSource | null {
  if (kind === "language") {
    const row = stats.language.find((l) => l.theme === key);
    return row
      ? { kind, key, name: row.theme, quotes: row.quotes.map((q) => q.quote), conversations: row.count, percent: null }
      : null;
  }
  const list =
    kind === "faq"
      ? stats.faq
      : kind === "objection"
        ? stats.objections
        : kind === "non_buying"
          ? stats.non_buying
          : stats.motivations;
  const row = list.find((r) => r.key === key);
  if (!row) return null;
  // Además de los ejemplos del grupo, las frases del cliente del mismo tema.
  const extra =
    stats.language.find((l) => l.theme.toLocaleLowerCase("es") === row.name.toLocaleLowerCase("es"))?.quotes ?? [];
  const quotes = [...new Set([...row.examples.map((e) => e.quote), ...extra.map((e) => e.quote)])].slice(0, 15);
  return { kind, key, name: row.name, quotes, conversations: row.conversations, percent: row.percent };
}

const KIND_LABEL: Record<ContentSourceKind, string> = {
  faq: "pregunta frecuente",
  objection: "objeción",
  non_buying: "motivo de no compra",
  motivation: "motivo de compra",
  language: "tema del lenguaje del cliente",
};

const SYSTEM = `Eres estratega de contenido para una marca personal en español (público de España). Creas contenido a partir de lo que dicen clientes reales en WhatsApp. Devuelves SOLO JSON:
{"hooks":["x5"],"reels":[{"title":"","hook":"","script":"","cta":""} x3],"carousel":{"title":"","slides":["5-10"]},"email":{"subject":"","body":""},"whatsapp_reply":"","masterclass":{"title":"","promise":"","outline":["3-8"]},"faq":{"question":"","answer":""}}

Reglas:
- Usa el lenguaje real de las frases recibidas: sus palabras, sus miedos, su forma de decirlo.
- No inventes problemas, cifras ni testimonios que no estén en los datos.
- No prometas resultados garantizados.
- "whatsapp_reply": cómo responder a esta situación por WhatsApp, breve y sin presionar.
- La información de la oferta que recibas es la única fuente de datos del producto.`;

export async function generateContent(params: {
  workspaceId: string;
  source: ContentSource;
  offerContext: string;
}): Promise<ContentPack> {
  const s = params.source;
  const user = [
    `Origen: ${KIND_LABEL[s.kind]} «${s.name}» — aparece en ${s.conversations} conversaciones${s.percent !== null ? ` (${s.percent} %)` : ""}.`,
    `Frases literales de clientes:\n${s.quotes.map((q) => `- "${q}"`).join("\n")}`,
    params.offerContext ? `Información de la oferta:\n${params.offerContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const { data } = await callJson({
    schema: ContentResponseSchema,
    system: SYSTEM,
    user,
    workspaceId: params.workspaceId,
    maxOutputTokens: 6000,
  });
  return data;
}
