// Reads the FIRST message someone sends to an owner's personal WhatsApp and
// tells whether it sounds like a new prospect or like someone who already
// knows the owner (friend, relative, old student, colleague).

export type FirstMessageVerdict = "prospect" | "personal";

export const CLASSIFIER_PROMPT = `Eres un filtro. Recibes el PRIMER mensaje que alguien envía al WhatsApp personal de Antonio Sastre, hipnotista y mentor de ventas, que ofrece formaciones de hipnosis, sesiones privadas de hipnosis, mentoring 1:1 y formación de ventas para empresas.

Responde con UNA sola palabra:
- NUEVO: parece una persona interesada en sus servicios o que pide información, o es un saludo neutro sin más ("Hola", "Buenas tardes", "Info", "Quiero información", "Hola, vi vuestro anuncio", mensajes ya escritos desde una web o un anuncio, preguntas por precios, fechas, ciudades o la hipnosis).
- CONOCIDO: parece alguien que ya conoce a Antonio: le trata con confianza o cariño ("Hola Antonio, ¿cómo estás?", "¡Hola papá!", "¿Qué tal todo?"), habla de algo personal, familiar o de trabajo que comparten, hace bromas o comentarios como si ya hubiera conversación previa, es un antiguo alumno, o envía felicitaciones, recados o mensajes que no buscan información.

Si dudas entre las dos, responde NUEVO.`;

/** Pure: turns the model's answer into a verdict. Anything unclear is a prospect. */
export function parseVerdict(raw: string): FirstMessageVerdict {
  const word = raw.trim().toUpperCase();
  return word.startsWith("CONOCIDO") ? "personal" : "prospect";
}

const CLASSIFIER_MODEL = "openai/gpt-4o-mini";

export async function classifyFirstMessage(params: {
  workspaceId: string;
  text: string;
}): Promise<FirstMessageVerdict> {
  try {
    const { generateReply } = await import("./openrouter");
    const result = await generateReply({
      model: CLASSIFIER_MODEL,
      systemPrompt: CLASSIFIER_PROMPT,
      userMessage: params.text.slice(0, 1500),
      workspaceId: params.workspaceId,
    });
    return parseVerdict(result.text);
  } catch (err) {
    // The Kapso history check already passed: a model hiccup must not leave a
    // real lead unanswered.
    console.error(
      "[first-message-classifier] failed:",
      err instanceof Error ? err.message : "unknown",
    );
    return "prospect";
  }
}
