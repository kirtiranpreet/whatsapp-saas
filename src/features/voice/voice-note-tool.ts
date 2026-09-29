import { z } from "zod";
import type { Tool } from "@/features/tools/core/tool";

const schema = z.object({});

type Args = z.infer<typeof schema>;

/**
 * Pide que la respuesta de este turno salga como nota de voz.
 *
 * Solo se ofrece al agente cuando su voz está en modo "special" (buffer.ts
 * la añade a las herramientas del turno; no pasa por el catálogo). **No envía
 * nada al correr**: buffer.ts convierte la respuesta en audio al enviarla.
 */
export const replyWithVoiceTool: Tool<Args> = {
  name: "reply_with_voice",
  sensitivity: "read",
  description:
    "Hace que tu próxima respuesta se envíe como nota de voz, con tu voz, en vez de " +
    "por escrito. Solo tienes una en toda la conversación: úsala en el momento que más " +
    "confianza genera (el cliente desapareció tras recibir la información, expresa dudas " +
    "o desconfianza, o duda antes de agendar), nunca para datos, listas o precios. " +
    "Llámala antes de escribir tu respuesta y luego escribe la respuesta como la dirías hablando.",
  schema,
  enabledFor: () => true,
  run: async () => ({
    ok: true,
    output: {
      voice_note: true,
      message:
        "Tu respuesta se enviará como nota de voz. Escríbela como la dirías hablando: 50-90 palabras, natural, sin listas ni emojis.",
    },
  }),
};
