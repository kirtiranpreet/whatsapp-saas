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
    "por escrito. Úsala solo en momentos especiales que ganan con una voz (el cliente " +
    "te mandó un audio, expresa dudas o desconfianza, o le invitas a la llamada), " +
    "nunca para datos o listas. Llámala antes de escribir tu respuesta y luego escribe " +
    "la respuesta como la dirías hablando.",
  schema,
  enabledFor: () => true,
  run: async () => ({
    ok: true,
    output: {
      voice_note: true,
      message:
        "Tu respuesta se enviará como nota de voz. Escríbela como la dirías hablando: corta, natural, sin listas ni emojis.",
    },
  }),
};
