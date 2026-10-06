// Inteligencia de conversaciones — esquemas de lo que devuelve el modelo y de
// lo que se guarda. Todo dato extraído lleva `ref`: la referencia ("m12") al
// mensaje original del transcript. Lo que no se puede comprobar contra ese
// mensaje se descarta en verify.ts.

import { z } from "zod";
import {
  OBJECTION_CATEGORIES,
  OBJECTION_KINDS,
  NON_BUYING_CATEGORIES,
  OUTCOMES,
  INTENT_LEVELS,
  SENTIMENTS,
  MOMENT_TYPES,
  FUNNEL_STAGES,
  RECOMMENDATION_TYPES,
} from "./constants";

export {
  OBJECTION_CATEGORIES,
  OBJECTION_KINDS,
  NON_BUYING_CATEGORIES,
  OUTCOMES,
  INTENT_LEVELS,
  SENTIMENTS,
  MOMENT_TYPES,
  FUNNEL_STAGES,
  RECOMMENDATION_TYPES,
};

const ref = z.string().regex(/^m\d+$/);
const shortText = (max: number) => z.string().trim().min(1).max(max);

/** Lo que el modelo devuelve para UNA conversación (antes de verificar). */
export const RawExtractionSchema = z.object({
  questions: z
    .array(z.object({ ref, quote: shortText(400), normalized: shortText(80) }))
    .default([]),
  objections: z
    .array(
      z.object({
        ref,
        category: z.enum(OBJECTION_CATEGORIES),
        kind: z.enum(OBJECTION_KINDS),
        quote: z.string().trim().max(400).nullable().default(null),
        note: z.string().trim().max(240).default(""),
      }),
    )
    .default([]),
  intent: z.object({
    level: z.enum(INTENT_LEVELS),
    reason: shortText(400),
    signals: z
      .array(z.object({ ref, signal: shortText(160) }))
      .default([]),
  }),
  buying_motivations: z
    .array(z.object({ ref, label: shortText(60), quote: shortText(400) }))
    .default([]),
  non_buying_reasons: z
    .array(
      z.object({
        category: z.enum(NON_BUYING_CATEGORIES),
        ref: ref.nullable().default(null),
        quote: z.string().trim().max(400).nullable().default(null),
        inferred: z.boolean().default(false),
      }),
    )
    .default([]),
  outcome: z.object({
    status: z.enum(OUTCOMES),
    ref: ref.nullable().default(null),
    explanation: shortText(400),
  }),
  sentiment: z.enum(SENTIMENTS),
  topics: z.array(shortText(60)).max(8).default([]),
  key_moments: z
    .array(z.object({ ref, type: z.enum(MOMENT_TYPES), note: shortText(200) }))
    .default([]),
  customer_language: z
    .array(z.object({ ref, quote: shortText(400), theme: shortText(40) }))
    .default([]),
  funnel_stage: z.enum(FUNNEL_STAGES),
  summary: shortText(600),
});

export type RawExtraction = z.infer<typeof RawExtractionSchema>;

/** Una cita ya comprobada: texto literal del mensaje y el mensaje del que sale. */
export interface Evidence {
  message_id: string;
  at: string;
  quote: string;
}

/** Lo que se guarda tras verificar: las refs ya son ids de mensaje reales. */
export interface VerifiedExtraction {
  questions: Array<{ normalized: string; evidence: Evidence }>;
  objections: Array<{
    category: (typeof OBJECTION_CATEGORIES)[number];
    kind: (typeof OBJECTION_KINDS)[number];
    note: string;
    evidence: Evidence;
  }>;
  intent: {
    level: (typeof INTENT_LEVELS)[number];
    reason: string;
    signals: Array<{ signal: string; evidence: Evidence }>;
  };
  buying_motivations: Array<{ label: string; evidence: Evidence }>;
  non_buying_reasons: Array<{
    category: (typeof NON_BUYING_CATEGORIES)[number];
    inferred: boolean;
    evidence: Evidence | null;
  }>;
  outcome: {
    status: (typeof OUTCOMES)[number];
    explanation: string;
    evidence: Evidence | null;
    /** Hechos de la base de datos que fijaron o corrigieron el resultado. */
    facts: string[];
  };
  sentiment: (typeof SENTIMENTS)[number];
  topics: string[];
  key_moments: Array<{
    type: (typeof MOMENT_TYPES)[number];
    note: string;
    message_id: string;
    at: string;
  }>;
  customer_language: Array<{ theme: string; evidence: Evidence }>;
  funnel_stage: (typeof FUNNEL_STAGES)[number];
  summary: string;
}

export type DroppedCounts = Record<string, number>;

/** Agrupación de etiquetas libres (FAQ, motivos, temas, lenguaje). */
export const ClusterResponseSchema = z.object({
  groups: z.array(
    z.object({
      name: shortText(80),
      members: z.array(z.string()).min(1),
    }),
  ),
});



export const RecommendationResponseSchema = z.object({
  summary: shortText(1200),
  recommendations: z
    .array(
      z.object({
        type: z.enum(RECOMMENDATION_TYPES),
        title: shortText(140),
        problem: shortText(500),
        action: shortText(700),
        impact: shortText(300),
        based_on: z.array(z.string()).min(1),
      }),
    )
    .max(10),
});

export const ContentResponseSchema = z.object({
  hooks: z.array(shortText(220)).length(5),
  reels: z
    .array(
      z.object({
        title: shortText(120),
        hook: shortText(220),
        script: shortText(1500),
        cta: shortText(220),
      }),
    )
    .length(3),
  carousel: z.object({
    title: shortText(120),
    slides: z.array(shortText(400)).min(5).max(10),
  }),
  email: z.object({ subject: shortText(140), body: shortText(3000) }),
  whatsapp_reply: shortText(1200),
  masterclass: z.object({
    title: shortText(140),
    promise: shortText(300),
    outline: z.array(shortText(240)).min(3).max(8),
  }),
  faq: z.object({ question: shortText(240), answer: shortText(1200) }),
});

export type ContentPack = z.infer<typeof ContentResponseSchema>;
