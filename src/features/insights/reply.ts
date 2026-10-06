// "¿Qué debería responder?" — propone una respuesta para una conversación.
// NO la envía: la dueña la revisa y la copia. Usa información real de la
// oferta (las instrucciones del agente y la información del negocio), el
// contexto de la conversación y lo que el análisis detectó.

import { z } from "zod";
import { getActiveAgent } from "@/features/agents/services/active-agent";
import { buildBusinessInfoContext, getBusinessInfo } from "@/features/inbox/services/business-info";
import { callJson } from "./llm";
import { conversationContext, conversationMessages, type Db } from "./repo";
import type { VerifiedExtraction } from "./schema";
import { buildTranscript, renderTranscript } from "./transcript";

export const ReplySchema = z.object({
  context: z.string().trim().min(1).max(600),
  goal: z.string().trim().min(1).max(300),
  reply: z.string().trim().min(1).max(1500),
  why: z.string().trim().min(1).max(700),
});

export type SuggestedReply = z.infer<typeof ReplySchema> & {
  window_open: boolean;
  window_note: string | null;
};

const SYSTEM = `Eres la mejor vendedora del negocio y redactas UNA respuesta de WhatsApp para continuar esta conversación. Devuelves SOLO JSON:
{"context":"qué está pasando, en 1-2 frases","goal":"qué busca conseguir esta respuesta","reply":"el mensaje listo para enviar","why":"por qué se recomienda, apoyado en lo que dijo el cliente"}

Reglas:
- Usa SOLO la información de la oferta que recibes (precios, fechas, condiciones). Si un dato no está, no lo inventes: formula la respuesta sin él.
- Responde a lo último que dijo o preguntó el cliente. Si hay una objeción, trátala con respeto, sin presionar y sin llamarla excusa.
- Mismo tono que el agente en la conversación: cercano, breve, natural, en español de España si el cliente escribe así.
- Un solo mensaje, corto (máximo 5 líneas). Sin emojis excesivos.
- No prometas resultados ni garantías que no aparezcan en la información de la oferta.`;

async function agentInstructions(db: Db, workspaceId: string): Promise<{ name: string; prompt: string }> {
  const agent = await getActiveAgent(workspaceId);
  let prompt = "";
  if (agent?.promptId) {
    const { data: p } = await db
      .from("prompts")
      .select("active_version_id")
      .eq("workspace_id", workspaceId)
      .eq("id", agent.promptId)
      .maybeSingle();
    if (p?.active_version_id) {
      const { data: v } = await db
        .from("prompt_versions")
        .select("body")
        .eq("workspace_id", workspaceId)
        .eq("id", p.active_version_id)
        .maybeSingle();
      prompt = ((v?.body as string | undefined) ?? "").slice(0, 12000);
    }
  }
  return { name: agent?.name ?? "el agente", prompt };
}

export async function suggestReply(db: Db, workspaceId: string, conversationId: string): Promise<SuggestedReply | null> {
  const ctx = await conversationContext(db, workspaceId, conversationId);
  if (!ctx) return null;

  const [messages, info, agent, conv, insight] = await Promise.all([
    conversationMessages(db, workspaceId, conversationId),
    getBusinessInfo(workspaceId),
    agentInstructions(db, workspaceId),
    db.from("conversations").select("window_expires_at").eq("workspace_id", workspaceId).eq("id", conversationId).maybeSingle(),
    db
      .from("conversation_insights")
      .select("extraction")
      .eq("workspace_id", workspaceId)
      .eq("conversation_id", conversationId)
      .eq("status", "done")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const lines = buildTranscript(messages).slice(-40);
  if (lines.length === 0) return null;

  const x = insight.data?.extraction as VerifiedExtraction | undefined;
  const detected = x
    ? `LO QUE DETECTÓ EL ANÁLISIS:\n- Intención: ${x.intent.level} (${x.intent.reason})\n- Objeciones: ${
        x.objections.map((o) => `${o.category} (${o.kind}): "${o.evidence.quote.slice(0, 160)}"`).join("; ") || "ninguna"
      }\n- Resultado: ${x.outcome.status}\n\n`
    : "";

  const user = [
    `INFORMACIÓN DE LA OFERTA (instrucciones de ${agent.name}):\n${agent.prompt || "(no disponible)"}`,
    buildBusinessInfoContext(info),
    detected,
    `CONVERSACIÓN (las más recientes al final):\n${renderTranscript(lines)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const { data } = await callJson({ schema: ReplySchema, system: SYSTEM, user, workspaceId, maxOutputTokens: 1500 });

  const expires = conv.data?.window_expires_at as string | null | undefined;
  const windowOpen = !!expires && Date.parse(expires) > Date.now();
  return {
    ...data,
    window_open: windowOpen,
    window_note: windowOpen
      ? null
      : "Han pasado más de 24 h desde el último mensaje del cliente: WhatsApp solo permite escribirle con una plantilla aprobada.",
  };
}
