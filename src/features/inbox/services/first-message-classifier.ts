// Reads the FIRST message someone sends to an owner's personal WhatsApp and
// tells whether it sounds like a new prospect or like someone who already
// knows the owner (friend, relative, old student, colleague).

export type FirstMessageVerdict = "prospect" | "personal";

export const CLASSIFIER_PROMPT = `Eres un filtro estricto. Recibes el PRIMER mensaje que alguien envía al WhatsApp personal de Antonio Sastre, hipnotista y mentor de ventas, que ofrece formaciones de hipnosis (presencial Hipnosis Rápida de Alto Impacto y online Hipnosis Conversacional), sesiones privadas de hipnosis, mentoring 1:1 y formación de ventas para empresas. Por este número le escriben también su familia, amigos, alumnos, proveedores y colaboradores, y a ellos les responde Antonio en persona.

Responde con UNA sola palabra:
- NUEVO: SOLO si el mensaje pide información clara sobre sus servicios: menciona la formación, el curso, la hipnosis, una sesión, el mentoring, un anuncio, el webinar o una ciudad o fecha de la formación, pregunta precios, fechas o cómo apuntarse, o es uno de los mensajes ya escritos de la web o de un anuncio ("Quiero información", "Quiero reservar mi plaza en…", "Hola, vi el anuncio…", mensajes con la palabra HIPNOSIS, el mensaje automático de los formularios de Meta "He completado el formulario y me gustaría recibir más información…"), o la persona dice que está interesada ("Estoy interesado", "Tengo interés", "Me interesa").
- CONOCIDO: todo lo demás. Por ejemplo: un saludo suelto sin pedir nada ("Hola", "Buenas", "¿Qué tal?"), mensajes que tratan a Antonio con confianza o le llaman por su nombre para algo personal, temas de trabajo o logística (salas, alquileres, proveedores, facturas, pagos, presupuestos, colaboraciones), enlaces, fotos o contactos sin una pregunta sobre sus servicios, ofertas comerciales o cobros de otras empresas, felicitaciones, recados y cualquier mensaje que no sea claramente una persona interesada en sus servicios.

Si dudas, responde CONOCIDO: Antonio ve todos los mensajes en su móvil y prefiere atender él a alguien antes que la asistente le escriba a un conocido.`;

// Phrases that always mean a prospect, checked before the model: the automatic
// text of Meta lead forms and plain interest/price/service questions. The model
// (gpt-4o-mini) was sending these to the owner as "personal".
const CLEAR_LEAD_PATTERNS: RegExp[] = [
  /completado el formulario/,
  /\bfull name\s*:/,
  /\bnombre completo\s*:/,
  /\binteresad[oa]s?\b/,
  /\btengo interes\b/,
  /\bme interesa\b/,
  /\b(mas|recibir|pedir|quiero|quisiera|solicito|solicitar)\s+(la\s+)?info(rmacion)?\b/,
  /\binfo(rmacion)?\s+(sobre|del|de la|de los)\b/,
  /\bhipno/,
  /\bformacion(es)?\b/,
  /\bcursos?\b/,
  /\bmentor(ia|ing)\b/,
  /\bwebinar\b/,
  /\b(reservar|apuntarme|inscribirme|inscripcion)\b/,
  /\b(precio|coste|costo|cuanto (cuesta|vale|sale))\b/,
  /\bvi (el|tu|su|vuestro) anuncio\b/,
];

/**
 * Pure: true when the first message is clearly a prospect, without asking the
 * model. Case- and accent-insensitive.
 */
export function isClearLead(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return CLEAR_LEAD_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Pure: turns the model's answer into a verdict. Only a clear NUEVO is a
 * prospect; anything else stays with the owner.
 */
export function parseVerdict(raw: string): FirstMessageVerdict {
  const word = raw.trim().toUpperCase();
  return word.startsWith("NUEVO") ? "prospect" : "personal";
}

const CLASSIFIER_MODEL = "openai/gpt-4o-mini";

export async function classifyFirstMessage(params: {
  workspaceId: string;
  text: string;
}): Promise<FirstMessageVerdict> {
  if (isClearLead(params.text)) return "prospect";
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
    // On a personal number a lead waiting for the owner (who sees it on the
    // phone) is better than the assistant writing to someone he knows.
    console.error(
      "[first-message-classifier] failed:",
      err instanceof Error ? err.message : "unknown",
    );
    return "personal";
  }
}
