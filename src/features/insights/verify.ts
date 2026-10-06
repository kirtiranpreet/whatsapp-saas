// Verificación de lo que devuelve el modelo. Regla: ningún dato llega al
// informe si no se puede comprobar contra un mensaje real.
//   · toda `ref` debe existir en el transcript (y ser del cliente cuando es
//     algo que dijo el cliente);
//   · toda cita debe aparecer literalmente en ese mensaje (se toleran
//     mayúsculas y espacios; se guarda el texto exacto del mensaje);
//   · un resultado "compró" o "rechazó" necesita un mensaje que lo pruebe;
//   · los hechos de la base de datos (cita agendada, cliente en el CRM)
//     corrigen el resultado cuando el modelo no los vio.
// Lo descartado se cuenta en `dropped` para poder auditarlo.

import type {
  DroppedCounts,
  Evidence,
  RawExtraction,
  VerifiedExtraction,
} from "./schema";
import type { TranscriptLine } from "./transcript";

export interface ConversationFacts {
  /** Hay una cita (llamada) agendada en esta conversación. */
  appointmentBooked: boolean;
  /** El contacto está marcado como cliente en el CRM. */
  isCustomer: boolean;
}

const QUOTE_EDGES = /^[\s"'“”«»‘’`]+|[\s"'“”«»‘’`]+$/g;

function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!lastSpace) {
        norm += " ";
        map.push(i);
        lastSpace = true;
      }
      continue;
    }
    norm += ch.toLocaleLowerCase("es");
    map.push(i);
    lastSpace = false;
  }
  return { norm, map };
}

/**
 * El fragmento EXACTO de `text` que corresponde a `quote`, o null si la cita
 * no aparece literalmente. Ignora mayúsculas, espacios repetidos, comillas en
 * los extremos y unos puntos suspensivos finales.
 */
export function findLiteral(quote: string, text: string): string | null {
  const cleaned = quote.replace(QUOTE_EDGES, "").replace(/(\.\.\.|…)$/, "").trim();
  if (cleaned.length < 3) return null;
  const q = normalizeWithMap(cleaned).norm.trim();
  const { norm, map } = normalizeWithMap(text);
  const at = norm.indexOf(q);
  if (at < 0) return null;
  const start = map[at];
  const end = map[at + q.length - 1] + 1;
  return text.slice(start, end);
}

export function verifyExtraction(
  raw: RawExtraction,
  lines: TranscriptLine[],
  facts: ConversationFacts,
): { extraction: VerifiedExtraction; dropped: DroppedCounts } {
  const byRef = new Map(lines.map((l) => [l.ref, l]));
  const dropped: DroppedCounts = {};
  const drop = (key: string) => {
    dropped[key] = (dropped[key] ?? 0) + 1;
  };

  const customerLine = (ref: string | null | undefined): TranscriptLine | null => {
    if (!ref) return null;
    const line = byRef.get(ref);
    return line && line.speaker === "cliente" && line.hasText ? line : null;
  };
  const evidence = (line: TranscriptLine, quote: string): Evidence => ({
    message_id: line.messageId,
    at: line.at,
    quote,
  });
  /** Evidencia con cita literal obligatoria. */
  const quoted = (ref: string, quote: string | null): Evidence | null => {
    const line = customerLine(ref);
    if (!line || !quote) return null;
    const literal = findLiteral(quote, line.text);
    return literal ? evidence(line, literal) : null;
  };

  const questions: VerifiedExtraction["questions"] = [];
  for (const q of raw.questions) {
    const ev = quoted(q.ref, q.quote);
    if (ev) questions.push({ normalized: q.normalized.trim(), evidence: ev });
    else drop("questions");
  }

  const objections: VerifiedExtraction["objections"] = [];
  for (const o of raw.objections) {
    let ev: Evidence | null = null;
    if (o.quote) {
      ev = quoted(o.ref, o.quote);
    } else if (o.kind === "inferencia") {
      // Una inferencia de la IA no cita: se enseña el mensaje completo en el
      // que se apoya, marcada como inferencia.
      const line = customerLine(o.ref);
      ev = line ? evidence(line, line.text) : null;
    }
    if (ev) objections.push({ category: o.category, kind: o.kind, note: o.note, evidence: ev });
    else drop("objections");
  }

  const signals: VerifiedExtraction["intent"]["signals"] = [];
  for (const s of raw.intent.signals) {
    const line = customerLine(s.ref);
    if (line) signals.push({ signal: s.signal, evidence: evidence(line, line.text) });
    else drop("intent_signals");
  }
  // Intención alta o media sin ninguna señal comprobable no se sostiene.
  let level = raw.intent.level;
  if (level !== "baja" && signals.length === 0) {
    level = "baja";
    drop("intent_level_without_evidence");
  }

  const buying_motivations: VerifiedExtraction["buying_motivations"] = [];
  for (const m of raw.buying_motivations) {
    const ev = quoted(m.ref, m.quote);
    if (ev) buying_motivations.push({ label: m.label.trim(), evidence: ev });
    else drop("buying_motivations");
  }

  // ── Resultado ──
  const facts_: string[] = [];
  let status = raw.outcome.status;
  let outcomeEvidence: Evidence | null = null;
  if (raw.outcome.ref) {
    const line = byRef.get(raw.outcome.ref);
    if (line && line.hasText) outcomeEvidence = evidence(line, line.text);
  }
  if ((status === "compro" || status === "rechazo") && !outcomeEvidence) {
    status = "indeterminado";
    drop("outcome_without_evidence");
  }
  if (facts.isCustomer && status !== "compro") {
    status = "compro";
    facts_.push("El contacto figura como cliente en el CRM.");
  }
  if (
    facts.appointmentBooked &&
    (status === "pendiente" || status === "indeterminado" || status === "no_compro")
  ) {
    status = "agendo_llamada";
    facts_.push("Hay una llamada agendada en esta conversación.");
  }

  const non_buying_reasons: VerifiedExtraction["non_buying_reasons"] = [];
  if (status !== "compro") {
    for (const r of raw.non_buying_reasons) {
      if (r.ref) {
        const line = customerLine(r.ref);
        if (!line) {
          drop("non_buying_reasons");
          continue;
        }
        const literal = r.quote ? findLiteral(r.quote, line.text) : null;
        if (r.quote && !literal) {
          drop("non_buying_reasons");
          continue;
        }
        non_buying_reasons.push({
          category: r.category,
          inferred: r.inferred,
          evidence: evidence(line, literal ?? line.text),
        });
      } else {
        // Sin mensaje que lo respalde solo puede ser una inferencia.
        non_buying_reasons.push({ category: r.category, inferred: true, evidence: null });
      }
    }
  }

  const key_moments: VerifiedExtraction["key_moments"] = [];
  for (const k of raw.key_moments) {
    const line = byRef.get(k.ref);
    if (line) key_moments.push({ type: k.type, note: k.note, message_id: line.messageId, at: line.at });
    else drop("key_moments");
  }
  key_moments.sort((a, b) => a.at.localeCompare(b.at));

  const customer_language: VerifiedExtraction["customer_language"] = [];
  const seenQuotes = new Set<string>();
  for (const c of raw.customer_language) {
    const ev = quoted(c.ref, c.quote);
    if (!ev) {
      drop("customer_language");
      continue;
    }
    const key = `${ev.message_id}|${ev.quote.toLocaleLowerCase("es")}`;
    if (seenQuotes.has(key)) continue;
    seenQuotes.add(key);
    customer_language.push({ theme: c.theme.trim().toLocaleLowerCase("es"), evidence: ev });
  }

  const topics = [...new Set(raw.topics.map((t) => t.trim().toLocaleLowerCase("es")).filter(Boolean))];

  return {
    extraction: {
      questions,
      objections,
      intent: { level, reason: raw.intent.reason, signals },
      buying_motivations,
      non_buying_reasons,
      outcome: {
        status,
        explanation: raw.outcome.explanation,
        evidence: outcomeEvidence,
        facts: facts_,
      },
      sentiment: raw.sentiment,
      topics,
      key_moments,
      customer_language,
      funnel_stage: raw.funnel_stage,
      summary: raw.summary,
    },
    dropped,
  };
}
