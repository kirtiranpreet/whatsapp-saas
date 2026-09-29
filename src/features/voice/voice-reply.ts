// Envía la respuesta del agente como nota de voz: ElevenLabs la convierte en
// audio, se guarda en whatsapp-media (así el inbox la reproduce) y sale por
// dispatchMedia, el mismo punto único de envío que el resto.

import { createClient as createSbClient } from "@supabase/supabase-js";
import { dispatchMedia, type DispatchResult } from "@/features/inbox/services/dispatch";
import { elevenLabsApiKey, synthesizeSpeech } from "./elevenlabs";

const BUCKET = "whatsapp-media";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Returns the send's result, or null when nothing was sent because the audio
 * couldn't be made (no key, ElevenLabs down, storage failed): the caller then
 * sends the reply as text, so the contact always gets an answer.
 */
export async function dispatchVoiceReply(params: {
  workspaceId: string;
  conversationId: string;
  batchId: string;
  /** What the voice says (links already taken out). */
  spoken: string;
  voiceId: string;
  /** Extra keys for the outbound row's meta (the buffer's batch_id). */
  meta?: Record<string, unknown>;
}): Promise<DispatchResult | null> {
  const apiKey = elevenLabsApiKey();
  if (!apiKey) {
    console.warn("[voice] ELEVENLABS_API_KEY is not set: replying in text");
    return null;
  }

  let audio;
  try {
    audio = await synthesizeSpeech({ apiKey, voiceId: params.voiceId, text: params.spoken });
  } catch (err) {
    console.error("[voice] text-to-speech failed, replying in text:", {
      batchId: params.batchId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  // {workspace}/{conversation}/{file}: the shape the inbox's media-url accepts.
  const storagePath = `${params.workspaceId}/${params.conversationId}/voz-${params.batchId}.${audio.extension}`;
  const { error: uploadError } = await svc()
    .storage.from(BUCKET)
    .upload(storagePath, audio.bytes, { contentType: audio.mimeType, upsert: true });
  if (uploadError) {
    console.error("[voice] audio upload failed, replying in text:", uploadError.message);
    return null;
  }

  return dispatchMedia({
    workspaceId: params.workspaceId,
    conversationId: params.conversationId,
    kind: "audio",
    storagePath,
    mimeType: audio.mimeType,
    filename: `voz.${audio.extension}`,
    sizeBytes: audio.bytes.byteLength,
    body: params.spoken,
    meta: { ...(params.meta ?? {}), transcript: params.spoken, voice_reply: true },
  });
}
