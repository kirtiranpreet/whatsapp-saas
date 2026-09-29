// Respuestas en nota de voz con ElevenLabs.
//
// La clave es de la instalación (ELEVENLABS_API_KEY en Vercel); cada agente
// elige en su configuración cuándo responde en audio y con qué voz.

import type { AgentConfig } from "@/features/agents/types";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const TTS_TIMEOUT_MS = 30_000;

/** Modelo multilingüe: habla español de España con naturalidad. */
export const ELEVENLABS_MODEL = "eleven_multilingual_v2";

/**
 * - off: nunca en audio.
 * - special: el agente decide, en momentos que generan confianza, con la
 *   herramienta reply_with_voice (como mucho MAX_SPECIAL_VOICE_NOTES por
 *   conversación).
 * - on_audio: cada vez que el cliente manda una nota de voz.
 * - always: siempre.
 */
export type VoiceReplyMode = "off" | "special" | "on_audio" | "always";

/**
 * En modo "special", las notas de voz que el agente puede mandar por
 * conversación: una sola, guardada para el momento que más confianza genera.
 */
export const MAX_SPECIAL_VOICE_NOTES = 1;

export interface VoiceReplyConfig {
  mode: VoiceReplyMode;
  voiceId: string;
  voiceName?: string;
}

/** Más de esto hablado es un audio de más de un minuto: mejor por escrito. */
export const MAX_SPOKEN_CHARS = 900;

export function elevenLabsApiKey(): string | null {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  return key ? key : null;
}

/** El ajuste de voz del agente, o null si no responde en audio. */
export function voiceReplyOf(config: AgentConfig | null | undefined): VoiceReplyConfig | null {
  const raw = config?.voiceReply as Partial<VoiceReplyConfig> | undefined;
  if (!raw || typeof raw !== "object") return null;
  if (raw.mode !== "special" && raw.mode !== "on_audio" && raw.mode !== "always") return null;
  if (typeof raw.voiceId !== "string" || !raw.voiceId.trim()) return null;
  return {
    mode: raw.mode,
    voiceId: raw.voiceId.trim(),
    voiceName: typeof raw.voiceName === "string" ? raw.voiceName : undefined,
  };
}

/** Si este turno se responde en audio, según el modo y lo que mandó el cliente. */
export function shouldReplyWithVoice(
  voice: VoiceReplyConfig | null,
  opts: { customerSentAudio: boolean; agentAsked: boolean },
): boolean {
  if (!voice) return false;
  switch (voice.mode) {
    case "always":
      return true;
    case "on_audio":
      return opts.customerSentAudio;
    case "special":
      return opts.agentAsked;
    default:
      return false;
  }
}

/**
 * Lo que el agente lee en modo "special": cuándo vale la pena una nota de voz
 * y cómo escribir el texto para que suene natural.
 */
export const SPECIAL_VOICE_NOTE_CONTEXT = [
  "## Notas de voz",
  "Puedes enviar tu respuesta como nota de voz, con tu voz, llamando a la herramienta reply_with_voice " +
    "antes de escribir la respuesta. Tienes una sola nota de voz en toda la conversación: guárdala para el " +
    "momento en que escuchar una voz genere más confianza (si tus instrucciones dicen cuándo usarla, síguelas). " +
    "Por ejemplo: el cliente desapareció después de recibir la información, expresa dudas, miedo o " +
    "desconfianza, o duda justo antes de agendar. No la uses para respuestas de trámite, datos, listas ni " +
    "precios. Cuando ya la hayas usado, esta herramienta deja de estar disponible.",
  "Cuando la uses, escribe la respuesta como la dirías hablando, de 50 a 90 palabras (20-35 segundos): " +
    "frases cortas y naturales, sin listas, sin emojis ni formato. Si incluyes un enlace, se enviará por " +
    "escrito aparte, justo después del audio.",
].join("\n");

const URL_RE = /https?:\/\/[^\s)>\]]+/g;

/**
 * Separa la respuesta en lo que se dice en voz alta y los enlaces, que van
 * por escrito: un enlace leído en un audio no sirve para nada. También quita
 * el formato de WhatsApp (*negrita*, _cursiva_) y los emojis, que la voz
 * leería o pronunciaría raro.
 */
export function splitSpokenReply(text: string): { spoken: string; links: string[] } {
  const links = Array.from(new Set(text.match(URL_RE) ?? []));
  const spoken = text
    .replace(URL_RE, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/:\s*$/gm, ".")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { spoken, links };
}

export class ElevenLabsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ElevenLabsError";
    this.status = status;
  }
}

function isOgg(bytes: Uint8Array): boolean {
  // "OggS" — the container WhatsApp needs to show a voice note.
  return bytes.length > 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
}

async function ttsRequest(
  apiKey: string,
  voiceId: string,
  text: string,
  outputFormat: string,
): Promise<Uint8Array> {
  const res = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${outputFormat}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/*",
      },
      body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL }),
    },
  );
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json()).slice(0, 300);
    } catch {
      /* no body */
    }
    throw new ElevenLabsError(res.status, `ElevenLabs TTS ${res.status} ${detail}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Convierte el texto en audio. Primero en Opus dentro de OGG (se ve como nota
 * de voz en WhatsApp); si ElevenLabs no lo devuelve en ese contenedor, en MP3
 * (llega como archivo de audio).
 */
export async function synthesizeSpeech(params: {
  apiKey: string;
  voiceId: string;
  text: string;
}): Promise<{ bytes: Uint8Array; mimeType: string; extension: string }> {
  const opus = await ttsRequest(params.apiKey, params.voiceId, params.text, "opus_48000_64");
  if (isOgg(opus)) return { bytes: opus, mimeType: "audio/ogg", extension: "ogg" };
  const mp3 = await ttsRequest(params.apiKey, params.voiceId, params.text, "mp3_44100_64");
  return { bytes: mp3, mimeType: "audio/mpeg", extension: "mp3" };
}

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  description: string;
  previewUrl: string | null;
}

/** Las voces de la cuenta de ElevenLabs (las propias y las añadidas). */
export async function listElevenLabsVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
  const res = await fetch(`${ELEVENLABS_BASE}/voices`, {
    signal: AbortSignal.timeout(15_000),
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) throw new ElevenLabsError(res.status, `ElevenLabs voices ${res.status}`);
  const json = (await res.json()) as {
    voices?: Array<{
      voice_id?: string;
      name?: string;
      preview_url?: string | null;
      labels?: Record<string, string>;
      description?: string | null;
    }>;
  };
  return (json.voices ?? [])
    .filter((v) => typeof v.voice_id === "string" && typeof v.name === "string")
    .map((v) => {
      const labels = v.labels ?? {};
      const bits = [labels.gender, labels.accent, labels.age, labels.description ?? labels.use_case]
        .filter((b): b is string => typeof b === "string" && b.trim() !== "")
        .join(" · ");
      return {
        voiceId: v.voice_id as string,
        name: v.name as string,
        description: bits || (v.description ?? ""),
        previewUrl: v.preview_url ?? null,
      };
    });
}
