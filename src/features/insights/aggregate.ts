// Agregados del informe. Todo número sale de contar extracciones ya
// verificadas: el modelo no calcula frecuencias ni porcentajes.
//
// Frecuencia = veces que aparece; conversaciones = en cuántas conversaciones
// aparece al menos una vez; porcentaje = conversaciones / base × 100 (base:
// conversaciones analizadas; para "motivos de no compra", las que no compraron).

import {
  FUNNEL_STAGES,
  INTENT_LEVELS,
  OBJECTION_KINDS,
  OUTCOMES,
  SENTIMENTS,
  type Evidence,
  type VerifiedExtraction,
} from "./schema";

export interface AnalyzedConversation {
  conversationId: string;
  contactLabel: string;
  extraction: VerifiedExtraction;
}

export interface Example extends Evidence {
  conversation_id: string;
}

export interface CountRow {
  key: string;
  name: string;
  occurrences: number;
  conversations: number;
  percent: number;
  examples: Example[];
}

export interface ReportStats {
  totals: { conversations: number; analyzed: number; failed: number; not_purchased: number };
  faq: CountRow[];
  objections: Array<CountRow & { by_kind: Record<string, number> }>;
  intent: Array<{ key: string; level: string; count: number; percent: number }>;
  motivations: CountRow[];
  non_buying: Array<CountRow & { inferred: number }>;
  outcomes: Array<{ key: string; status: string; count: number; percent: number }>;
  sentiment: Array<{ sentiment: string; count: number; percent: number }>;
  topics: CountRow[];
  language: Array<{ theme: string; count: number; quotes: Example[] }>;
  funnel: Array<{ stage: string; reached: number; percent: number }>;
  conversations: Array<{
    conversation_id: string;
    contact: string;
    outcome: string;
    intent: string;
    sentiment: string;
    summary: string;
  }>;
}

export type LabelMap = Map<string, string>;

const MAX_EXAMPLES = 5;
const MAX_QUOTES_PER_THEME = 12;

export function percent(part: number, base: number): number {
  if (base <= 0) return 0;
  return Math.round((part / base) * 1000) / 10;
}

/** Etiqueta canónica de un grupo (si no se agrupó, la propia etiqueta). */
export function canonical(map: LabelMap, label: string): string {
  const k = label.trim().toLocaleLowerCase("es");
  return map.get(k) ?? label.trim();
}

class Counter {
  private rows = new Map<string, { name: string; occ: number; convs: Set<string>; examples: Example[] }>();

  add(key: string, name: string, conversationId: string, ev: Evidence | null) {
    let row = this.rows.get(key);
    if (!row) {
      row = { name, occ: 0, convs: new Set(), examples: [] };
      this.rows.set(key, row);
    }
    row.occ += 1;
    row.convs.add(conversationId);
    // Un ejemplo por conversación, para que los ejemplos sean variados.
    if (
      ev &&
      row.examples.length < MAX_EXAMPLES &&
      !row.examples.some((e) => e.conversation_id === conversationId)
    ) {
      row.examples.push({ ...ev, conversation_id: conversationId });
    }
  }

  convsOf(key: string): number {
    return this.rows.get(key)?.convs.size ?? 0;
  }

  toRows(prefix: string, base: number): CountRow[] {
    return [...this.rows.entries()]
      .map(([key, r]) => ({
        key: `${prefix}:${key}`,
        name: r.name,
        occurrences: r.occ,
        conversations: r.convs.size,
        percent: percent(r.convs.size, base),
        examples: r.examples,
      }))
      .sort((a, b) => b.conversations - a.conversations || b.occurrences - a.occurrences || a.name.localeCompare(b.name));
  }
}

const slug = (s: string) => s.trim().toLocaleLowerCase("es");

export function aggregate(
  items: AnalyzedConversation[],
  opts: {
    totalConversations: number;
    failed: number;
    faqMap: LabelMap;
    motivationMap: LabelMap;
    topicMap: LabelMap;
    themeMap: LabelMap;
  },
): ReportStats {
  const base = items.length;
  const faq = new Counter();
  const objections = new Counter();
  const objectionKinds = new Map<string, Record<string, number>>();
  const motivations = new Counter();
  const nonBuying = new Counter();
  const nonBuyingInferred = new Map<string, number>();
  const topics = new Counter();
  const intent = new Map<string, number>();
  const outcomes = new Map<string, number>();
  const sentiment = new Map<string, number>();
  const funnelReached = new Map<string, number>();
  const language = new Map<string, { count: number; quotes: Example[] }>();
  let notPurchased = 0;

  for (const { conversationId: cid, extraction: x } of items) {
    for (const q of x.questions) {
      const name = canonical(opts.faqMap, q.normalized);
      faq.add(slug(name), name, cid, q.evidence);
    }
    for (const o of x.objections) {
      objections.add(o.category, o.category, cid, o.evidence);
      const kinds = objectionKinds.get(o.category) ?? {};
      kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
      objectionKinds.set(o.category, kinds);
    }
    for (const m of x.buying_motivations) {
      const name = canonical(opts.motivationMap, m.label);
      motivations.add(slug(name), name, cid, m.evidence);
    }
    if (x.outcome.status !== "compro") notPurchased += 1;
    for (const r of x.non_buying_reasons) {
      nonBuying.add(r.category, r.category, cid, r.evidence);
      if (r.inferred) nonBuyingInferred.set(r.category, (nonBuyingInferred.get(r.category) ?? 0) + 1);
    }
    for (const t of x.topics) {
      const name = canonical(opts.topicMap, t);
      topics.add(slug(name), name, cid, null);
    }
    intent.set(x.intent.level, (intent.get(x.intent.level) ?? 0) + 1);
    outcomes.set(x.outcome.status, (outcomes.get(x.outcome.status) ?? 0) + 1);
    sentiment.set(x.sentiment, (sentiment.get(x.sentiment) ?? 0) + 1);

    // Embudo acumulado: llegar a "objeción" implica haber pasado las anteriores.
    const reachedIdx = FUNNEL_STAGES.indexOf(x.funnel_stage);
    for (let i = 0; i <= reachedIdx; i++) {
      funnelReached.set(FUNNEL_STAGES[i], (funnelReached.get(FUNNEL_STAGES[i]) ?? 0) + 1);
    }

    for (const c of x.customer_language) {
      const theme = canonical(opts.themeMap, c.theme);
      const row = language.get(theme) ?? { count: 0, quotes: [] };
      row.count += 1;
      if (row.quotes.length < MAX_QUOTES_PER_THEME) row.quotes.push({ ...c.evidence, conversation_id: cid });
      language.set(theme, row);
    }
  }

  // Un mismo motivo de no compra cuenta una vez por conversación en "inferidos"
  // solo si todas sus apariciones lo fueron; aquí se informa el número de
  // apariciones inferidas para transparencia.
  const nonBuyingRows = nonBuying.toRows("non_buying", notPurchased).map((r) => ({
    ...r,
    inferred: nonBuyingInferred.get(r.key.slice("non_buying:".length)) ?? 0,
  }));

  return {
    totals: {
      conversations: opts.totalConversations,
      analyzed: base,
      failed: opts.failed,
      not_purchased: notPurchased,
    },
    faq: faq.toRows("faq", base),
    objections: objections.toRows("objection", base).map((r) => ({
      ...r,
      by_kind: Object.fromEntries(
        OBJECTION_KINDS.map((k) => [k, objectionKinds.get(r.key.slice("objection:".length))?.[k] ?? 0]),
      ),
    })),
    intent: INTENT_LEVELS.map((level) => ({
      key: `intent:${level}`,
      level,
      count: intent.get(level) ?? 0,
      percent: percent(intent.get(level) ?? 0, base),
    })),
    motivations: motivations.toRows("motivation", base),
    non_buying: nonBuyingRows,
    outcomes: OUTCOMES.map((status) => ({
      key: `outcome:${status}`,
      status,
      count: outcomes.get(status) ?? 0,
      percent: percent(outcomes.get(status) ?? 0, base),
    })),
    sentiment: SENTIMENTS.map((s) => ({
      sentiment: s,
      count: sentiment.get(s) ?? 0,
      percent: percent(sentiment.get(s) ?? 0, base),
    })),
    topics: topics.toRows("topic", base),
    language: [...language.entries()]
      .map(([theme, r]) => ({ theme, count: r.count, quotes: r.quotes }))
      .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme)),
    funnel: FUNNEL_STAGES.map((stage) => ({
      stage,
      reached: funnelReached.get(stage) ?? 0,
      percent: percent(funnelReached.get(stage) ?? 0, base),
    })),
    conversations: items.map((i) => ({
      conversation_id: i.conversationId,
      contact: i.contactLabel,
      outcome: i.extraction.outcome.status,
      intent: i.extraction.intent.level,
      sentiment: i.extraction.sentiment,
      summary: i.extraction.summary,
    })),
  };
}

/** Claves que una recomendación puede citar como origen ("faq:precio", …). */
export function statKeys(stats: ReportStats): Set<string> {
  const keys = new Set<string>();
  for (const r of [...stats.faq, ...stats.objections, ...stats.motivations, ...stats.non_buying, ...stats.topics]) {
    keys.add(r.key);
  }
  for (const r of stats.intent) keys.add(r.key);
  for (const r of stats.outcomes) keys.add(r.key);
  return keys;
}
