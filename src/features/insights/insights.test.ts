import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregate, median, percent, type AnalyzedConversation } from "./aggregate.ts";
import { compareStats } from "./evolution.ts";
import { classifyFollowUp, detectSignals, type FollowUpInput } from "./followups.ts";
import { keepGrounded } from "./grounding.ts";
import { toLabelMap } from "./group-map.ts";
import { lastFullWeek, weeklyReportDue } from "./period.ts";
import type { RawExtraction, VerifiedExtraction } from "./schema.ts";
import { buildTranscript, redact, type SourceMessage } from "./transcript.ts";
import { findLiteral, verifyExtraction } from "./verify.ts";

// ── Transcript ──────────────────────────────────────────────────────────────

const msg = (
  id: string,
  direction: "in" | "out",
  body: string | null,
  at: string,
  extra: Partial<SourceMessage> = {},
): SourceMessage => ({
  id,
  direction,
  type: "text",
  body,
  sender_user_id: null,
  meta: direction === "out" ? { batch_id: "b1" } : {},
  created_at: at,
  ...extra,
});

const conversation: SourceMessage[] = [
  msg("a", "in", "Hola, ¿cuánto cuesta la formación?", "2026-10-01T10:00:00Z"),
  msg("b", "out", "Hola, soy Laura. La formación es el 31 de octubre.", "2026-10-01T10:01:00Z"),
  msg("c", "in", "Me parece caro, ya hice tres cursos y sigo igual. Mi móvil es +34 600 123 456", "2026-10-01T10:05:00Z"),
  msg("d", "out", "nota interna", "2026-10-01T10:06:00Z", { meta: { internal: true } }),
  msg("e", "out", "Te respondo yo, Antonio", "2026-10-01T10:07:00Z", { sender_user_id: "user-1", meta: {} }),
  msg("f", "in", null, "2026-10-01T10:08:00Z", { type: "audio" }),
  msg("g", "in", "¿Cómo puedo pagar? Pásame el enlace", "2026-10-01T10:09:00Z"),
];

test("transcript: numbers messages, labels speakers, skips internal notes", () => {
  const lines = buildTranscript(conversation);
  assert.deepEqual(
    lines.map((l) => [l.ref, l.messageId, l.speaker]),
    [
      ["m1", "a", "cliente"],
      ["m2", "b", "agente"],
      ["m3", "c", "cliente"],
      ["m4", "e", "equipo"],
      ["m5", "f", "cliente"],
      ["m6", "g", "cliente"],
    ],
  );
  assert.equal(lines[4].hasText, false);
  assert.equal(lines[4].text, "[nota de voz]");
  // No se pierden mensajes con contenido y el orden es cronológico.
  assert.equal(lines.length, conversation.length - 1);
});

test("transcript: phones and emails never reach the model", () => {
  assert.equal(redact("llámame al +34 600 123 456 o a ana@mail.com"), "llámame al [teléfono] o a [email]");
  const lines = buildTranscript(conversation);
  assert.ok(!lines.some((l) => /600 123 456/.test(l.text)));
});

// ── Citas literales ─────────────────────────────────────────────────────────

test("findLiteral returns the exact text from the message or null", () => {
  const text = "Me parece caro, ya hice tres cursos  y sigo igual.";
  assert.equal(findLiteral("ya hice tres cursos y sigo igual", text), "ya hice tres cursos  y sigo igual");
  assert.equal(findLiteral("“ME PARECE CARO”", text), "Me parece caro");
  assert.equal(findLiteral("me parece carísimo", text), null);
  assert.equal(findLiteral("ok", text), null);
});

function raw(partial: Partial<RawExtraction>): RawExtraction {
  return {
    questions: [],
    objections: [],
    intent: { level: "baja", reason: "x", signals: [] },
    buying_motivations: [],
    non_buying_reasons: [],
    outcome: { status: "indeterminado", ref: null, explanation: "x" },
    sentiment: "neutro",
    topics: [],
    key_moments: [],
    customer_language: [],
    funnel_stage: "inicio",
    summary: "x",
    ...partial,
  };
}

const lines = buildTranscript(conversation);
const noFacts = { appointmentBooked: false, isCustomer: false };

test("verify: invented quotes and agent messages are dropped", () => {
  const { extraction, dropped } = verifyExtraction(
    raw({
      questions: [
        { ref: "m1", quote: "¿cuánto cuesta la formación?", normalized: "Precio" },
        { ref: "m1", quote: "¿hay descuento?", normalized: "Descuento" }, // inventada
        { ref: "m2", quote: "La formación es el 31 de octubre", normalized: "Fechas" }, // es del agente
        { ref: "m99", quote: "hola", normalized: "Saludo" }, // ref inexistente
      ],
      customer_language: [
        { ref: "m3", quote: "ya hice tres cursos y sigo igual", theme: "Resultados" },
        { ref: "m3", quote: "ya hice cuatro cursos", theme: "resultados" },
      ],
    }),
    lines,
    noFacts,
  );
  assert.equal(extraction.questions.length, 1);
  assert.equal(extraction.questions[0].evidence.message_id, "a");
  assert.equal(extraction.questions[0].evidence.quote, "¿cuánto cuesta la formación?");
  assert.equal(dropped.questions, 3);
  assert.equal(extraction.customer_language.length, 1);
  assert.equal(extraction.customer_language[0].theme, "resultados");
  assert.equal(dropped.customer_language, 1);
});

test("verify: objections keep their kind; inferences point to the message", () => {
  const { extraction } = verifyExtraction(
    raw({
      objections: [
        { ref: "m3", category: "precio", kind: "objecion_explicita", quote: "Me parece caro", note: "" },
        { ref: "m3", category: "experiencias_previas", kind: "inferencia", quote: null, note: "desconfía" },
        { ref: "m3", category: "miedo", kind: "preocupacion", quote: null, note: "sin cita" }, // no es inferencia: fuera
      ],
    }),
    lines,
    noFacts,
  );
  assert.equal(extraction.objections.length, 2);
  assert.equal(extraction.objections[0].kind, "objecion_explicita");
  assert.equal(extraction.objections[1].kind, "inferencia");
  assert.equal(extraction.objections[1].evidence.message_id, "c");
});

test("verify: no purchase without evidence; intent needs signals; system facts win", () => {
  const a = verifyExtraction(
    raw({
      intent: { level: "alta", reason: "x", signals: [] },
      outcome: { status: "compro", ref: null, explanation: "x" },
      non_buying_reasons: [{ category: "precio", ref: "m3", quote: "Me parece caro", inferred: false }],
    }),
    lines,
    noFacts,
  ).extraction;
  assert.equal(a.intent.level, "baja");
  assert.equal(a.outcome.status, "indeterminado");
  assert.equal(a.non_buying_reasons.length, 1);

  const b = verifyExtraction(
    raw({
      intent: { level: "alta", reason: "x", signals: [{ ref: "m6", signal: "pregunta cómo pagar" }] },
      outcome: { status: "pendiente", ref: null, explanation: "x" },
      non_buying_reasons: [{ category: "momento", ref: null, quote: null, inferred: false }],
    }),
    lines,
    { appointmentBooked: true, isCustomer: false },
  ).extraction;
  assert.equal(b.intent.level, "alta");
  assert.equal(b.intent.signals[0].evidence.message_id, "g");
  assert.equal(b.outcome.status, "agendo_llamada");
  assert.equal(b.outcome.facts.length, 1);
  // Sin mensaje de respaldo, un motivo de no compra solo puede ser inferencia.
  assert.equal(b.non_buying_reasons[0].inferred, true);
});

// ── Agregados y porcentajes ─────────────────────────────────────────────────

function verified(partial: Partial<VerifiedExtraction>): VerifiedExtraction {
  return {
    questions: [],
    objections: [],
    intent: { level: "baja", reason: "", signals: [] },
    buying_motivations: [],
    non_buying_reasons: [],
    outcome: { status: "indeterminado", explanation: "", evidence: null, facts: [] },
    sentiment: "neutro",
    topics: [],
    key_moments: [],
    customer_language: [],
    funnel_stage: "inicio",
    summary: "",
    ...partial,
  };
}

const ev = (id: string, quote = "q") => ({ message_id: id, at: "2026-10-01T10:00:00Z", quote });
const metrics = { messages: 10, customer_messages: 5, agent_messages: 5, duration_hours: 2, had_follow_up: false };

const items: AnalyzedConversation[] = [
  {
    conversationId: "c1",
    contactLabel: "Ana",
    metrics: { ...metrics, had_follow_up: true },
    extraction: verified({
      questions: [
        { normalized: "Precio", evidence: ev("1", "¿cuánto cuesta?") },
        { normalized: "precio de la formación", evidence: ev("2", "¿qué precio tiene?") },
      ],
      objections: [{ category: "precio", kind: "objecion_explicita", note: "", evidence: ev("3") }],
      intent: { level: "alta", reason: "", signals: [{ signal: "pago", evidence: ev("4") }] },
      outcome: { status: "agendo_llamada", explanation: "", evidence: null, facts: [] },
      funnel_stage: "decision",
      sentiment: "positivo",
    }),
  },
  {
    conversationId: "c2",
    contactLabel: "Bea",
    metrics,
    extraction: verified({
      questions: [{ normalized: "Fechas", evidence: ev("5") }],
      objections: [
        { category: "precio", kind: "duda", note: "", evidence: ev("6") },
        { category: "tiempo", kind: "obstaculo", note: "", evidence: ev("7") },
      ],
      non_buying_reasons: [{ category: "precio", inferred: true, evidence: null }],
      outcome: { status: "no_compro", explanation: "", evidence: null, facts: [] },
      funnel_stage: "objecion",
    }),
  },
  {
    conversationId: "c3",
    contactLabel: "Carla",
    metrics,
    extraction: verified({
      outcome: { status: "pendiente", explanation: "", evidence: null, facts: [] },
      funnel_stage: "interes",
    }),
  },
];

const stats = aggregate(items, {
  totalConversations: 4,
  failed: 1,
  faqMap: new Map([
    ["precio", "Precio / inversión"],
    ["precio de la formación", "Precio / inversión"],
  ]),
  motivationMap: new Map(),
  topicMap: new Map(),
  themeMap: new Map(),
});

test("aggregate: percentages are conversations over the analyzed base", () => {
  assert.equal(percent(1, 3), 33.3);
  assert.equal(percent(0, 0), 0);
  assert.equal(stats.totals.analyzed, 3);
  assert.equal(stats.totals.failed, 1);

  const price = stats.faq.find((r) => r.name === "Precio / inversión")!;
  assert.equal(price.occurrences, 2); // dos preguntas…
  assert.equal(price.conversations, 1); // …en una sola conversación
  assert.equal(price.percent, 33.3);
  assert.equal(price.examples.length, 1); // un ejemplo por conversación

  const priceObj = stats.objections.find((r) => r.key === "objection:precio")!;
  assert.equal(priceObj.conversations, 2);
  assert.equal(priceObj.percent, 66.7);
  assert.deepEqual(priceObj.by_kind.objecion_explicita, 1);
  assert.deepEqual(priceObj.by_kind.duda, 1);
});

test("aggregate: outcomes and intent add up; non-buying uses non-purchased base", () => {
  assert.equal(stats.outcomes.reduce((a, o) => a + o.count, 0), 3);
  assert.equal(stats.intent.reduce((a, o) => a + o.count, 0), 3);
  assert.equal(stats.totals.not_purchased, 3);
  const nb = stats.non_buying.find((r) => r.key === "non_buying:precio")!;
  assert.equal(nb.percent, 33.3);
  assert.equal(nb.inferred, 1);
});

test("aggregate: funnel is cumulative", () => {
  const reached = Object.fromEntries(stats.funnel.map((f) => [f.stage, f.reached]));
  assert.equal(reached.inicio, 3);
  assert.equal(reached.interes, 3);
  assert.equal(reached.objecion, 2);
  assert.equal(reached.decision, 1);
});

test("aggregate: converted vs not converted profiles report sample size", () => {
  assert.equal(stats.conversion.converted.n, 1);
  assert.equal(stats.conversion.not_converted.n, 1);
  assert.equal(stats.conversion.excluded, 1);
  assert.equal(stats.conversion.converted.sufficient, false);
  assert.equal(stats.conversion.converted.pct_with_follow_up, 100);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

// ── Agrupación y recomendaciones ────────────────────────────────────────────

test("label grouping must cover every label exactly once", () => {
  const labels = ["Precio", "precio del curso", "Fechas"];
  const ok = toLabelMap(labels, [
    { name: "Precio / inversión", members: ["Precio", "precio del curso"] },
    { name: "Fechas", members: ["Fechas"] },
  ]);
  assert.equal(ok?.get("precio del curso"), "Precio / inversión");
  assert.equal(toLabelMap(labels, [{ name: "X", members: ["Precio", "Inventada"] }]), null);
  assert.equal(toLabelMap(labels, [{ name: "X", members: ["Precio"] }]), null);
});

test("recommendations without real data keys are discarded", () => {
  const recs = keepGrounded(
    [
      { type: "crear_faq", title: "a", problem: "", action: "", impact: "", based_on: ["faq:precio / inversión"] },
      { type: "mejorar_cta", title: "b", problem: "", action: "", impact: "", based_on: ["faq:inventada"] },
    ],
    stats,
  );
  assert.equal(recs.length, 1);
  assert.equal(recs[0].title, "a");
});

test("evolution compares percentages in points", () => {
  const prev = aggregate([items[1]], {
    totalConversations: 1,
    failed: 0,
    faqMap: new Map(),
    motivationMap: new Map(),
    topicMap: new Map(),
    themeMap: new Map(),
  });
  const evo = compareStats(stats, prev, "prev");
  const price = evo.objections.find((r) => r.key === "objection:precio")!;
  assert.equal(price.previous, 100);
  assert.equal(price.current, 66.7);
  assert.equal(price.trend, "baja");
});

// ── Seguimientos ────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-10-10T12:00:00Z");
const base: FollowUpInput = {
  conversationId: "c",
  contactLabel: "Ana",
  conversationState: "ai_active",
  lastCustomerAt: null,
  lastBusinessAt: null,
  lastCustomerText: null,
  lastCustomerQuestion: null,
  lastBusinessText: null,
  customerMessages: [],
  appointmentBooked: false,
  isCustomer: false,
  analyzed: null,
};
const hoursBefore = (h: number) => new Date(NOW - h * 3600_000).toISOString();

test("follow-ups: status describes time without reply", () => {
  const at = (h: number) =>
    classifyFollowUp({ ...base, lastCustomerAt: hoursBefore(h), lastBusinessAt: hoursBefore(h - 0.5) }, NOW).status;
  assert.equal(at(5), "activa");
  assert.equal(at(30), "seguimiento_pendiente");
  assert.equal(at(100), "enfriandose");
  assert.equal(at(200), "alto_riesgo");
  const unanswered = classifyFollowUp({ ...base, lastCustomerAt: hoursBefore(2), lastBusinessAt: hoursBefore(3) }, NOW);
  assert.equal(unanswered.status, "sin_responder");
  const booked = classifyFollowUp({ ...base, lastCustomerAt: hoursBefore(200), appointmentBooked: true }, NOW);
  assert.equal(booked.status, "cerrada");
});

test("follow-ups: buying signals come from real customer messages", () => {
  const signals = detectSignals([
    { id: "1", text: "¿Cómo puedo pagar?", at: hoursBefore(5) },
    { id: "2", text: "pásame el enlace porfa", at: hoursBefore(4) },
    { id: "3", text: "gracias", at: hoursBefore(3) },
  ]);
  assert.deepEqual(signals.map((s) => s.message_id).sort(), ["1", "2"]);
  const item = classifyFollowUp(
    {
      ...base,
      lastCustomerAt: hoursBefore(30),
      lastBusinessAt: hoursBefore(29),
      customerMessages: [
        { id: "1", text: "¿Cómo puedo pagar?", at: hoursBefore(31) },
        { id: "2", text: "pásame el enlace", at: hoursBefore(30) },
      ],
    },
    NOW,
  );
  assert.equal(item.intent, "alta");
  assert.equal(item.intent_source, "senales");
  assert.equal(item.priority, "alta");
});

// ── Periodos ────────────────────────────────────────────────────────────────

test("weekly period is Monday to Monday in the business time zone, DST included", () => {
  // Miércoles 4 nov 2026 (después del cambio de hora del 25 oct en España).
  const w = lastFullWeek(Date.parse("2026-11-04T10:00:00Z"), "Europe/Madrid");
  assert.equal(new Date(w.start).toISOString(), "2026-10-25T23:00:00.000Z"); // lun 26 oct 00:00 CET
  assert.equal(new Date(w.end).toISOString(), "2026-11-01T23:00:00.000Z"); // lun 2 nov 00:00 CET
  // Semana que contiene el cambio de hora: dura 7 días + 1 h.
  const dst = lastFullWeek(Date.parse("2026-10-28T10:00:00Z"), "Europe/Madrid");
  assert.equal(new Date(dst.start).toISOString(), "2026-10-18T22:00:00.000Z");
  assert.equal(new Date(dst.end).toISOString(), "2026-10-25T23:00:00.000Z");
});

test("weekly report is due on Monday from 08:00 local", () => {
  assert.equal(weeklyReportDue(Date.parse("2026-11-02T05:00:00Z"), "Europe/Madrid"), false); // lun 06:00
  assert.equal(weeklyReportDue(Date.parse("2026-11-02T07:30:00Z"), "Europe/Madrid"), true); // lun 08:30
  assert.equal(weeklyReportDue(Date.parse("2026-11-03T03:00:00Z"), "Europe/Madrid"), true); // mar 04:00
});
