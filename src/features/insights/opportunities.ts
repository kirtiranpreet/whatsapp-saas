// Carga los datos para "Oportunidades" y "Seguimientos" de las conversaciones
// recientes atendidas por el agente, y las clasifica con followups.ts.
// Consultas por lotes (no una por conversación) para que escale.

import { classifyFollowUp, type FollowUpInput, type FollowUpItem } from "./followups";
import { agentConversationIds, contactLabel, type Db } from "./repo";
import type { VerifiedExtraction } from "./schema";
import { isAgentMessage, redact, type SourceMessage } from "./transcript";

const WINDOW_DAYS = 30;
const MAX_CONVERSATIONS = 400;
const CHUNK = 100;

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function loadFollowUps(db: Db, workspaceId: string, now = Date.now()): Promise<FollowUpItem[]> {
  const from = new Date(now - WINDOW_DAYS * 24 * 3600_000).toISOString();
  const to = new Date(now + 60_000).toISOString();
  const ids = (await agentConversationIds(db, workspaceId, from, to)).slice(-MAX_CONVERSATIONS);
  if (ids.length === 0) return [];

  const convs = new Map<string, { state: string; label: string; stage: string | null }>();
  const msgs = new Map<string, Array<SourceMessage & { conversation_id: string }>>();
  const booked = new Set<string>();
  const analyzed = new Map<string, VerifiedExtraction>();

  for (const part of chunks(ids, CHUNK)) {
    const [c, m, a, i] = await Promise.all([
      db
        .from("conversations")
        .select("id, state, contacts(name, phone, stage)")
        .eq("workspace_id", workspaceId)
        .in("id", part),
      db
        .from("messages")
        .select("id, conversation_id, direction, type, body, sender_user_id, meta, created_at")
        .eq("workspace_id", workspaceId)
        .in("conversation_id", part)
        .gte("created_at", from)
        .order("created_at", { ascending: true })
        .limit(10000),
      db
        .from("appointments")
        .select("conversation_id")
        .eq("workspace_id", workspaceId)
        .in("conversation_id", part)
        .in("status", ["booked", "confirmed", "completed"]),
      db
        .from("conversation_insights")
        .select("conversation_id, extraction, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "done")
        .in("conversation_id", part)
        .order("updated_at", { ascending: false }),
    ]);
    for (const row of c.data ?? []) {
      const contact = (Array.isArray(row.contacts) ? row.contacts[0] : row.contacts) as
        | { name: string | null; phone: string | null; stage: string | null }
        | null;
      convs.set(row.id as string, { state: row.state as string, label: contactLabel(contact), stage: contact?.stage ?? null });
    }
    for (const row of (m.data ?? []) as Array<SourceMessage & { conversation_id: string }>) {
      const list = msgs.get(row.conversation_id) ?? [];
      list.push(row);
      msgs.set(row.conversation_id, list);
    }
    for (const row of a.data ?? []) booked.add(row.conversation_id as string);
    for (const row of i.data ?? []) {
      const id = row.conversation_id as string;
      if (!analyzed.has(id) && row.extraction) analyzed.set(id, row.extraction as VerifiedExtraction);
    }
  }

  const items: FollowUpItem[] = [];
  for (const id of ids) {
    const conv = convs.get(id);
    if (!conv) continue;
    const list = (msgs.get(id) ?? []).filter((m) => m.type !== "system" && (m.meta ?? {}).internal !== true);
    const customer = list.filter((m) => m.direction === "in");
    const business = list.filter((m) => m.direction === "out");
    const lastCustomer = customer[customer.length - 1] ?? null;
    const lastBusiness = business[business.length - 1] ?? null;
    const lastQuestion = [...customer].reverse().find((m) => (m.body ?? "").includes("?")) ?? null;
    const x = analyzed.get(id) ?? null;
    const mainObjection = x?.objections?.[0]?.category ?? null;

    const input: FollowUpInput = {
      conversationId: id,
      contactLabel: conv.label,
      conversationState: conv.state,
      lastCustomerAt: lastCustomer?.created_at ?? null,
      lastBusinessAt: lastBusiness?.created_at ?? null,
      lastCustomerText: lastCustomer?.body ? redact(lastCustomer.body).slice(0, 300) : null,
      lastCustomerQuestion: lastQuestion
        ? { text: redact(lastQuestion.body ?? "").slice(0, 300), at: lastQuestion.created_at, messageId: lastQuestion.id }
        : null,
      lastBusinessText: lastBusiness?.body
        ? `${isAgentMessage(lastBusiness) ? "Agente" : "Equipo"}: ${redact(lastBusiness.body).slice(0, 300)}`
        : null,
      customerMessages: customer
        .filter((m) => (m.body ?? "").trim())
        .map((m) => ({ id: m.id, text: redact(m.body ?? ""), at: m.created_at })),
      appointmentBooked: booked.has(id),
      isCustomer: conv.stage === "customer",
      analyzed: x
        ? {
            intent: x.intent.level,
            outcome: x.outcome.status,
            funnelStage: x.funnel_stage,
            mainObjection,
          }
        : null,
    };
    items.push(classifyFollowUp(input, now));
  }
  return items.sort((a, b) => b.score - a.score);
}
