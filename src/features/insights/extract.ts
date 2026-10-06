// Paso 1 del análisis: extracción estructurada de UNA conversación.
// Un modelo por conversación (no una llamada gigante con todo); la agregación
// y los porcentajes se hacen después en código.

import { callJson } from "./llm";
import {
  FUNNEL_STAGES,
  MOMENT_TYPES,
  NON_BUYING_CATEGORIES,
  OBJECTION_CATEGORIES,
  OBJECTION_KINDS,
  OUTCOMES,
  RawExtractionSchema,
  type DroppedCounts,
  type VerifiedExtraction,
} from "./schema";
import { renderTranscript, type TranscriptLine } from "./transcript";
import { verifyExtraction, type ConversationFacts } from "./verify";

export const EXTRACTION_SYSTEM = `Eres analista comercial. Analizas UNA conversación de WhatsApp entre un CLIENTE potencial y un AGENTE de ventas (a veces interviene una persona del EQUIPO). Devuelves SOLO un objeto JSON, sin texto alrededor.

Cada mensaje del transcript empieza con su referencia entre corchetes, por ejemplo [m7]. Toda referencia ("ref") que escribas debe ser una de esas, exactamente.

REGLAS DE EVIDENCIA (obligatorias):
- Las citas ("quote") son copias LITERALES de un fragmento del mensaje del CLIENTE al que apunta "ref". No corrijas ortografía, no resumas, no completes. Si no puedes citar literal, no incluyas el elemento.
- Solo cuenta lo que dijo el CLIENTE para preguntas, objeciones, motivos, señales de intención y lenguaje. Lo que dice el AGENTE o el EQUIPO es contexto.
- No inventes. Si algo no aparece, deja la lista vacía.
- No llames "excusa" a nada. Distingue el tipo ("kind") de cada objeción: objecion_explicita (lo plantea claramente como freno), preocupacion, duda, obstaculo (algo práctico que impide avanzar) o inferencia (lo deduces tú; sin cita, quote = null).
- No deduzcas una compra sin un mensaje que lo pruebe. "compro" y "rechazo" exigen "ref" al mensaje que lo demuestra.
- El sentimiento describe el tono de la conversación, nunca un diagnóstico psicológico.

FORMATO:
{
  "questions": [{"ref":"m3","quote":"¿cuánto cuesta?","normalized":"Precio / inversión"}],
  "objections": [{"ref":"m9","category":"${OBJECTION_CATEGORIES.join("|")}","kind":"${OBJECTION_KINDS.join("|")}","quote":"... o null si kind=inferencia","note":"breve explicación"}],
  "intent": {"level":"alta|media|baja","reason":"por qué, en una frase","signals":[{"ref":"m12","signal":"pregunta cómo pagar"}]},
  "buying_motivations": [{"ref":"m5","label":"claridad|ventas|acompañamiento|resultados|confianza|transformación|...","quote":"..."}],
  "non_buying_reasons": [{"category":"${NON_BUYING_CATEGORIES.join("|")}","ref":"m14 o null","quote":"... o null","inferred":false}],
  "outcome": {"status":"${OUTCOMES.join("|")}","ref":"m20 o null","explanation":"..."},
  "sentiment": "positivo|neutro|negativo|mixto",
  "topics": ["tema corto", "..."],
  "key_moments": [{"ref":"m4","type":"${MOMENT_TYPES.join("|")}","note":"..."}],
  "customer_language": [{"ref":"m6","quote":"frase literal con fuerza emocional o comercial","theme":"dinero|miedo|ventas|confianza|tiempo|claridad|resultados|..."}],
  "funnel_stage": "${FUNNEL_STAGES.join("|")}",
  "summary": "2-3 frases: qué buscaba, qué pasó, cómo quedó"
}

Guía:
- "normalized": la pregunta reducida a su intención, corta y reutilizable entre conversaciones (ej. "Precio / inversión", "Fechas disponibles", "Formas de pago", "Ubicación del curso").
- Señales de intención alta: pregunta cómo pagar, pide el enlace, pregunta disponibilidad/fechas/condiciones, dice que quiere empezar. Media: interés claro sin pasos concretos. Baja: curiosidad o rechazo.
- "outcome": compro (hay prueba de pago o inscripción), agendo_llamada (reservó la llamada), rechazo (dice que no explícitamente), no_compro (se enfrió o dejó de responder sin decir que no), pendiente (sigue abierta), indeterminado (no se puede saber).
- "non_buying_reasons": solo si no compró. "inferred": true cuando no lo dijo explícitamente.
- "funnel_stage": la etapa MÁS AVANZADA a la que llegó (inicio → interes → necesidad → pregunta → objecion → respuesta → decision).
- "customer_language": frases del cliente que valga la pena reutilizar en marketing (máximo 8).`;

export interface ExtractionResult {
  extraction: VerifiedExtraction;
  dropped: DroppedCounts;
  promptTokens: number;
  completionTokens: number;
}

export function factsBlock(facts: ConversationFacts): string {
  const lines: string[] = [];
  if (facts.appointmentBooked) lines.push("- El sistema registra una llamada agendada en esta conversación.");
  if (facts.isCustomer) lines.push("- El CRM marca a este contacto como cliente.");
  return lines.length > 0 ? `HECHOS DEL SISTEMA:\n${lines.join("\n")}\n\n` : "";
}

export async function extractConversation(params: {
  workspaceId: string;
  lines: TranscriptLine[];
  facts: ConversationFacts;
  agentName: string;
}): Promise<ExtractionResult> {
  const user =
    `${factsBlock(params.facts)}El AGENTE se llama ${params.agentName}.\n\nTRANSCRIPT:\n` +
    renderTranscript(params.lines);

  const { data, promptTokens, completionTokens } = await callJson({
    schema: RawExtractionSchema,
    system: EXTRACTION_SYSTEM,
    user,
    workspaceId: params.workspaceId,
    maxOutputTokens: 4000,
  });

  const { extraction, dropped } = verifyExtraction(data, params.lines, params.facts);
  return { extraction, dropped, promptTokens, completionTokens };
}
