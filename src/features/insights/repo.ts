// Acceso a datos del módulo (service role). Las rutas comprueban antes que
// quien llama es miembro del workspace; aquí cada consulta filtra además por
// workspace_id para que un id de otro workspace nunca devuelva nada.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveTimeZone } from "@/shared/lib/timezone";
import { isAgentMessage, type SourceMessage } from "./transcript";
import type { ConversationFacts } from "./verify";

export type Db = SupabaseClient;

export function svc(): Db {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export interface InsightsSettings {
  weekly: boolean;
  timeZone: string;
}

/** Ajustes del módulo: workspaces.settings.insights + zona horaria del negocio. */
export async function loadInsightsSettings(db: Db, workspaceId: string): Promise<InsightsSettings> {
  const [{ data: ws }, { data: info }] = await Promise.all([
    db.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle(),
    db.from("business_info").select("structured").eq("workspace_id", workspaceId).limit(1).maybeSingle(),
  ]);
  const settings = (ws?.settings ?? {}) as { insights?: { weekly?: unknown }; timezone?: string };
  const businessTz = ((info?.structured ?? {}) as { timezone?: string }).timezone;
  return {
    weekly: settings.insights?.weekly === true,
    timeZone: resolveTimeZone(businessTz, settings.timezone, "Europe/Madrid"),
  };
}

export async function saveInsightsSettings(db: Db, workspaceId: string, weekly: boolean): Promise<void> {
  const { data: ws, error } = await db.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  if (error || !ws) throw new Error("workspace_not_found");
  const settings = (ws.settings ?? {}) as Record<string, unknown>;
  const insights = { ...((settings.insights as Record<string, unknown>) ?? {}), weekly };
  const { error: upErr } = await db
    .from("workspaces")
    .update({ settings: { ...settings, insights } })
    .eq("id", workspaceId);
  if (upErr) throw new Error(upErr.message);
}

const PAGE = 1000;

/**
 * Conversaciones del workspace en las que el agente de IA respondió dentro
 * del periodo. Solo estas se analizan.
 */
export async function agentConversationIds(
  db: Db,
  workspaceId: string,
  from: string,
  to: string,
): Promise<string[]> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("messages")
      .select("id, conversation_id, direction, type, body, sender_user_id, meta, created_at")
      .eq("workspace_id", workspaceId)
      .eq("direction", "out")
      .is("sender_user_id", null)
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`agent_conversations: ${error.message}`);
    const rows = (data ?? []) as Array<SourceMessage & { conversation_id: string }>;
    for (const m of rows) if (isAgentMessage(m)) ids.add(m.conversation_id);
    if (rows.length < PAGE) break;
  }
  return [...ids];
}

export async function conversationMessages(
  db: Db,
  workspaceId: string,
  conversationId: string,
  until?: string,
): Promise<SourceMessage[]> {
  const out: SourceMessage[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = db
      .from("messages")
      .select("id, direction, type, body, sender_user_id, meta, created_at")
      .eq("workspace_id", workspaceId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (until) q = q.lt("created_at", until);
    const { data, error } = await q;
    if (error) throw new Error(`messages: ${error.message}`);
    const rows = (data ?? []) as SourceMessage[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** "María" o, sin nombre, "Contacto ···1234" (nunca el teléfono completo). */
export function contactLabel(contact: { name?: string | null; phone?: string | null } | null): string {
  const name = contact?.name?.trim();
  if (name) return name;
  const digits = (contact?.phone ?? "").replace(/\D/g, "");
  return digits ? `Contacto ···${digits.slice(-4)}` : "Contacto";
}

export interface ConversationContext {
  contactId: string;
  label: string;
  state: string;
  facts: ConversationFacts;
}

export async function conversationContext(
  db: Db,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationContext | null> {
  const { data: conv } = await db
    .from("conversations")
    .select("id, state, contact_id, contacts(name, phone, stage)")
    .eq("workspace_id", workspaceId)
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return null;
  const contact = (Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts) as
    | { name: string | null; phone: string | null; stage: string | null }
    | null;
  const { count } = await db
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .in("status", ["booked", "confirmed", "completed"]);
  return {
    contactId: conv.contact_id as string,
    label: contactLabel(contact),
    state: conv.state as string,
    facts: { appointmentBooked: (count ?? 0) > 0, isCustomer: contact?.stage === "customer" },
  };
}
