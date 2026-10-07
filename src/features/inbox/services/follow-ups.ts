// Programador de seguimientos automáticos (ver follow-up-plan.ts): corre en
// cada tick del cron buffer-flush (cada minuto) y crea un batch sin mensajes,
// con meta.follow_up, para cada conversación a la que le toca uno.

import { createClient as createSbClient } from "@supabase/supabase-js";
import {
  MIN_GAP_MS,
  WINDOW_DEADLINE_MS,
  dueFollowUp,
  followUpConfigOf,
  isQuiet,
  type FollowUpConfig,
  type FollowUpMeta,
} from "./follow-up-plan";

export {
  followUpInstruction,
  followUpOf,
  isNoSendReply,
  isNotAClientReply,
  stripNotAClientToken,
} from "./follow-up-plan";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

type Db = ReturnType<typeof svc>;

const MAX_CONVERSATIONS_PER_WORKSPACE = 200;

/** Un mensaje saliente del agente (no de una persona, ni interno). */
function isAgentMessage(m: { direction: string; sender_user_id: string | null; meta: Record<string, unknown> | null }): boolean {
  if (m.direction !== "out" || m.sender_user_id) return false;
  const meta = m.meta ?? {};
  if (meta.internal === true) return false;
  return typeof meta.batch_id === "string" || typeof meta.media_batch_id === "string";
}

/** El cliente escribió después de `after` (el seguimiento ya no tiene sentido). */
export async function customerWroteSince(
  supabase: Db,
  workspaceId: string,
  conversationId: string,
  after: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("messages")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("direction", "in")
    .gt("created_at", after)
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Crea los batches de seguimiento que tocan ahora. Devuelve cuántos creó.
 * Nunca lanza: un fallo aquí no puede frenar las respuestas normales.
 */
export async function scheduleFollowUps(now: number = Date.now()): Promise<number> {
  try {
    const supabase = svc();
    const { data: agents, error } = await supabase
      .from("agents")
      .select("workspace_id, config")
      .eq("is_active", true)
      .contains("config", { followUps: { enabled: true } });
    if (error) {
      console.error("[follow-ups] agents lookup error:", error.message);
      return 0;
    }
    let created = 0;
    for (const agent of agents ?? []) {
      const cfg = followUpConfigOf(agent.config as Record<string, unknown>);
      if (!cfg.enabled || isQuiet(now, cfg)) continue;
      created += await scheduleForWorkspace(supabase, agent.workspace_id as string, cfg, now);
    }
    return created;
  } catch (err) {
    console.error("[follow-ups] schedule failed:", err instanceof Error ? err.message : String(err));
    return 0;
  }
}

async function scheduleForWorkspace(
  supabase: Db,
  workspaceId: string,
  cfg: FollowUpConfig,
  now: number,
): Promise<number> {
  const firstDelayMs = cfg.delaysMinutes[0] * 60_000;
  const { data: convs, error } = await supabase
    .from("conversations")
    .select("id, last_message_at")
    .eq("workspace_id", workspaceId)
    .eq("state", "ai_active")
    .eq("ai_enabled", true)
    .gt("last_message_at", new Date(now - WINDOW_DEADLINE_MS).toISOString())
    .lt("last_message_at", new Date(now - Math.min(firstDelayMs, MIN_GAP_MS)).toISOString())
    .order("last_message_at", { ascending: false })
    .limit(MAX_CONVERSATIONS_PER_WORKSPACE);
  if (error) {
    console.error("[follow-ups] conversations lookup error:", error.message);
    return 0;
  }

  let created = 0;
  for (const conv of convs ?? []) {
    try {
      if (await scheduleForConversation(supabase, workspaceId, conv.id as string, cfg, now)) created++;
    } catch (err) {
      console.error("[follow-ups] conversation skipped:", {
        conversationId: conv.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return created;
}

async function scheduleForConversation(
  supabase: Db,
  workspaceId: string,
  conversationId: string,
  cfg: FollowUpConfig,
  now: number,
): Promise<boolean> {
  // The last visible message must be the agent's: after a customer message
  // the agent is still answering; after a person's, they own the thread.
  const { data: lastRows } = await supabase
    .from("messages")
    .select("direction, sender_user_id, meta, created_at")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(10);
  // Internal notes don't count (filtered here: a `not cs` filter would also
  // drop rows whose meta is null).
  type Row = { direction: string; sender_user_id: string | null; meta: Record<string, unknown> | null; created_at: string };
  const last = ((lastRows ?? []) as Row[]).find((m) => m.meta?.internal !== true);
  if (!last || !isAgentMessage(last)) return false;

  const { data: inRows } = await supabase
    .from("messages")
    .select("created_at")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1);
  const lastInbound = inRows?.[0]?.created_at as string | undefined;
  if (!lastInbound) return false;

  // Booked the call (api/webhooks/booking): no more follow-ups, ever.
  const { data: booked } = await supabase
    .from("message_batches")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .contains("meta", { booking: {} })
    .limit(1);
  if ((booked ?? []).length > 0) return false;

  // Anything unfinished for this conversation goes first.
  const { data: open } = await supabase
    .from("message_batches")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .in("status", ["buffering", "processing"])
    .limit(1);
  if ((open ?? []).length > 0) return false;

  // Follow-ups already made since that customer message (sent or not).
  const { data: prior } = await supabase
    .from("message_batches")
    .select("created_at, meta")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .contains("meta", { follow_up: { after: lastInbound } })
    .order("created_at", { ascending: false });
  const priorRows = (prior ?? []) as Array<{ created_at: string; meta: Record<string, unknown> | null }>;
  // The agent decided there was no point (already booked, asked to stop):
  // the sequence ends until the customer writes again.
  if (priorRows.some((r) => r.meta?.follow_up_skipped === true)) return false;

  const step = dueFollowUp(
    {
      lastInboundAt: Date.parse(lastInbound),
      sent: priorRows.length,
      lastFollowUpAt: priorRows[0] ? Date.parse(priorRows[0].created_at) : null,
    },
    now,
    cfg,
  );
  if (!step) return false;

  const { error } = await supabase.from("message_batches").insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    status: "buffering",
    silence_ms: 0,
    flush_at: new Date(now).toISOString(),
    message_count: 0,
    meta: { isolated: true, follow_up: { step, after: lastInbound } satisfies FollowUpMeta },
  });
  if (error) {
    console.error("[follow-ups] batch insert error:", error.message);
    return false;
  }
  return true;
}
