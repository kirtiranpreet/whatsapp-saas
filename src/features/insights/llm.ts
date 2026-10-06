// Llamada al modelo que exige JSON y lo valida con un esquema. Si la primera
// respuesta no cumple el esquema se reintenta una vez indicando el error.
// Si tampoco, se lanza: el que llama decide (marcar la conversación como
// fallida, o usar una alternativa determinista).

import type { z } from "zod";
import { generateChatReply } from "@/features/inbox/services/openrouter";

/** Modelo para el análisis. Configurable por variable de entorno. */
export function insightsModel(): string {
  return process.env.INSIGHTS_MODEL?.trim() || "anthropic/claude-sonnet-4.6";
}

export function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no_json");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export interface JsonCallResult<T> {
  data: T;
  promptTokens: number;
  completionTokens: number;
}

export async function callJson<S extends z.ZodTypeAny>(params: {
  schema: S;
  system: string;
  user: string;
  workspaceId: string;
  maxOutputTokens: number;
  model?: string;
}): Promise<JsonCallResult<z.infer<S>>> {
  const model = params.model ?? insightsModel();
  let lastError = "";
  let promptTokens = 0;
  let completionTokens = 0;
  const turns: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: params.user },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await generateChatReply({
      model,
      systemPrompt: params.system,
      messages: turns,
      maxOutputTokens: params.maxOutputTokens,
      workspaceId: params.workspaceId,
    });
    promptTokens += reply.promptTokens;
    completionTokens += reply.completionTokens;
    try {
      const parsed = params.schema.safeParse(parseJsonLoose(reply.text));
      if (parsed.success) {
        return { data: parsed.data, promptTokens, completionTokens };
      }
      lastError = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } catch {
      lastError = "La respuesta no era un JSON válido.";
    }
    turns.push(
      { role: "assistant", content: reply.text.slice(0, 4000) },
      {
        role: "user",
        content: `Tu respuesta no cumple el formato pedido (${lastError}). Devuelve SOLO el objeto JSON corregido, completo.`,
      },
    );
  }
  throw new Error(`invalid_json: ${lastError}`.slice(0, 300));
}
