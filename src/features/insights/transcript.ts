// Transcript numerado que ve el modelo. Cada mensaje recibe una referencia
// estable ("m1", "m2"…) para que todo lo que el modelo extraiga apunte a un
// mensaje real. Antes de salir hacia el modelo se quitan teléfonos y emails:
// no hacen falta para el análisis.

export interface SourceMessage {
  id: string;
  direction: "in" | "out";
  type: string;
  body: string | null;
  sender_user_id: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export type Speaker = "cliente" | "agente" | "equipo";

export interface TranscriptLine {
  ref: string;
  messageId: string;
  speaker: Speaker;
  at: string;
  /** Texto ya anonimizado: lo que ve el modelo y lo único que se puede citar. */
  text: string;
  /** False si el mensaje no tiene texto propio (audio sin transcribir, imagen…). */
  hasText: boolean;
}

const MAX_MESSAGES = 250;
const MAX_CHARS_PER_MESSAGE = 1500;

const MEDIA_LABEL: Record<string, string> = {
  audio: "[nota de voz]",
  image: "[imagen]",
  video: "[vídeo]",
  document: "[documento]",
  sticker: "[sticker]",
  location: "[ubicación]",
};

/** Mensaje saliente escrito por el agente de IA (no por una persona ni interno). */
export function isAgentMessage(m: SourceMessage): boolean {
  if (m.direction !== "out" || m.sender_user_id) return false;
  const meta = m.meta ?? {};
  if (meta.internal === true) return false;
  return typeof meta.batch_id === "string" || typeof meta.media_batch_id === "string";
}

function isInternal(m: SourceMessage): boolean {
  return m.type === "system" || (m.meta ?? {}).internal === true;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// 7+ dígitos seguidos, admitiendo separadores habituales y prefijo +.
const PHONE_RE = /\+?\d(?:[\s().-]?\d){6,}/g;

export function redact(text: string): string {
  return text.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[teléfono]");
}

export function buildTranscript(messages: SourceMessage[]): TranscriptLine[] {
  const usable = messages
    .filter((m) => !isInternal(m))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-MAX_MESSAGES);

  return usable.map((m, i) => {
    const raw = (m.body ?? "").trim();
    const hasText = raw.length > 0;
    const text = hasText
      ? redact(raw).slice(0, MAX_CHARS_PER_MESSAGE)
      : (MEDIA_LABEL[m.type] ?? "[mensaje sin texto]");
    const speaker: Speaker =
      m.direction === "in" ? "cliente" : isAgentMessage(m) ? "agente" : "equipo";
    return {
      ref: `m${i + 1}`,
      messageId: m.id,
      speaker,
      at: m.created_at,
      text,
      hasText,
    };
  });
}

const SPEAKER_LABEL: Record<Speaker, string> = {
  cliente: "CLIENTE",
  agente: "AGENTE",
  equipo: "EQUIPO (persona)",
};

export function renderTranscript(lines: TranscriptLine[]): string {
  return lines
    .map((l) => `[${l.ref}] ${l.at.slice(0, 16).replace("T", " ")} ${SPEAKER_LABEL[l.speaker]}: ${l.text}`)
    .join("\n");
}
