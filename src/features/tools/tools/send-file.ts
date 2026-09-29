import { createClient as createSbClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";
import {
  findFileByName,
  listAgentFiles,
} from "@/features/agent-files/service";

const schema = z.object({
  file_name: z.string().min(1).max(200),
});

type Args = z.infer<typeof schema>;

/**
 * Pide enviar un archivo de la biblioteca (Configuración → Archivos).
 *
 * **No envía nada al correr**, igual que handoff_human: el archivo sale
 * después de la respuesta del agente (buffer.ts → deliverReply), para que
 * llegue detrás del mensaje que lo presenta y solo si ese mensaje salió. Aquí
 * solo se valida el nombre y se devuelve el id del archivo.
 */
async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const supabase = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const files = await listAgentFiles(supabase, ctx.workspaceId);
  const file = findFileByName(files, args.file_name);

  if (!file) {
    const available = files.map((f) => `"${f.name}"`).join(", ");
    return {
      ok: false,
      output: null,
      error: available
        ? `No hay ningún archivo llamado "${args.file_name}". Los archivos disponibles son: ${available}. No le digas al cliente que se lo enviaste.`
        : "No hay archivos disponibles para enviar. No le digas al cliente que se lo enviaste.",
    };
  }

  return {
    ok: true,
    output: {
      send_file: true,
      file_id: file.id,
      name: file.name,
      message: ctx.playground
        ? `En la prueba no se envía nada: en WhatsApp, "${file.name}" llegaría justo después de tu respuesta.`
        : `"${file.name}" se enviará justo después de tu respuesta. Preséntalo en tu mensaje.`,
    },
  };
}

export const sendFileTool: Tool<Args> = {
  name: "send_file",
  // "read": correrla no cambia nada; el envío lo hace buffer.ts después de la
  // respuesta, así un turno que falla puede repetirse sin enviar dos veces.
  sensitivity: "read",
  description:
    "Envía al cliente por WhatsApp un archivo (PDF, audio, vídeo o imagen) de la " +
    "lista 'Archivos que puedes enviar'. Usa el nombre exacto del archivo. El " +
    "archivo llega justo después de tu respuesta, así que en tu mensaje " +
    "preséntalo brevemente. Úsala solo cuando la lista lo indique o el cliente " +
    "lo pida, y nunca envíes el mismo archivo dos veces en la conversación.",
  schema,
  // El gate real es tool_configs por workspace, como en todas las tools.
  enabledFor: () => true,
  run,
};
