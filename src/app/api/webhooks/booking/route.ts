/**
 * POST /api/webhooks/booking?wsid=<workspaceId>&token=<secret>
 *
 * Aviso de reserva desde un workflow de HighLevel ("Cita reservada" → acción
 * Webhook). Busca la conversación del contacto por su teléfono y crea un
 * turno del agente (batch sin mensajes con meta.booking) para que le
 * confirme la llamada, le dé la preparación y le envíe lo que toque. Desde
 * ahí, esa conversación no recibe más seguimientos automáticos.
 *
 * Auth: token por workspace en la URL, comparado en tiempo constante con
 * workspaces.settings.booking_webhook_secret.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient as createSbClient } from "@supabase/supabase-js";
import {
  describeStart,
  parseBookingNotice,
  type BookingMeta,
} from "@/features/inbox/services/booking-plan";
import { samePhone } from "@/features/inbox/services/phone";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const wsid = req.nextUrl.searchParams.get("wsid");
  const token = req.nextUrl.searchParams.get("token");
  if (!wsid || !token || !UUID_RE.test(wsid)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = svc();
  const { data: ws } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", wsid)
    .maybeSingle();
  const secret = (ws?.settings as { booking_webhook_secret?: unknown } | null)?.booking_webhook_secret;
  if (typeof secret !== "string" || secret.length < 16 || !safeEqual(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const notice = parseBookingNotice(body);
  if (!notice) {
    return NextResponse.json({ ok: true, matched: false, reason: "no_phone" });
  }

  // The contact, by phone (stored E.164; GHL may format it differently).
  const last9 = notice.phone.replace(/\D/g, "").slice(-9);
  const { data: candidates } = await supabase
    .from("contacts")
    .select("id, phone")
    .eq("workspace_id", wsid)
    .like("phone", `%${last9}`)
    .limit(10);
  const contact = (candidates ?? []).find(
    (c) => typeof c.phone === "string" && samePhone(c.phone, notice.phone, "34"),
  );
  if (!contact) {
    // Booked without talking to the agent first: nothing to follow up.
    return NextResponse.json({ ok: true, matched: false, reason: "no_contact" });
  }

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, state, ai_enabled")
    .eq("workspace_id", wsid)
    .eq("contact_id", contact.id)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conv) {
    return NextResponse.json({ ok: true, matched: false, reason: "no_conversation" });
  }

  // HighLevel may deliver the same event twice.
  if (notice.appointmentId) {
    const { data: dup } = await supabase
      .from("message_batches")
      .select("id")
      .eq("workspace_id", wsid)
      .eq("conversation_id", conv.id)
      .contains("meta", { booking: { appointment_id: notice.appointmentId } })
      .limit(1);
    if ((dup ?? []).length > 0) {
      return NextResponse.json({ ok: true, matched: true, duplicate: true });
    }
  }

  const booking: BookingMeta = {
    start: notice.start,
    when: describeStart(notice.start, notice.timeZone),
    appointment_id: notice.appointmentId,
    calendar: notice.calendar,
  };

  // Recorded even when the agent won't write (a person owns the thread): it
  // still stops the automatic follow-ups.
  const aiOwns = conv.state === "ai_active" && conv.ai_enabled === true;
  const { error } = await supabase.from("message_batches").insert({
    workspace_id: wsid,
    conversation_id: conv.id,
    status: aiOwns ? "buffering" : "processed",
    silence_ms: 0,
    flush_at: new Date().toISOString(),
    message_count: 0,
    meta: { isolated: true, booking },
  });
  if (error) {
    console.error("[booking webhook] batch insert failed:", error.message);
    return NextResponse.json({ error: "Could not record the booking" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, matched: true, agentWillWrite: aiOwns });
}
