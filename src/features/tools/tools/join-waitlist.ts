import { createClient as createSbClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";
import { normalizeCity, waitlistTags } from "@/features/waitlist/service";
import {
  addHLTags,
  getHLConfig,
  upsertHLContactByPhone,
} from "@/features/inbox/services/highlevel-client";

const schema = z.object({
  city: z.string().trim().min(1).max(80),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional(),
});

type Args = z.infer<typeof schema>;

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Apunta al cliente en la lista de espera de una ciudad (Configuración →
 * Lista de espera). Con HighLevel conectado, además le pone las etiquetas
 * "lista-espera" y "lista-espera-<ciudad>" para que un workflow le avise.
 *
 * Idempotente (una fila por contacto y ciudad; la etiqueta se añade sin
 * quitar otras), así que un turno que se repite no duplica nada: por eso es
 * "read" y no "write".
 */
async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const city = normalizeCity(args.city);

  if (ctx.playground) {
    return {
      ok: true,
      output: {
        waitlist: true,
        city,
        message: `En la prueba no se guarda nada: en WhatsApp, la persona quedaría apuntada en la lista de espera de ${city}.`,
      },
    };
  }

  const supabase = svc();
  const { data: contact } = await supabase
    .from("contacts")
    .select("phone, name, email")
    .eq("id", ctx.contactId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();

  const name = args.name?.trim() || (contact?.name as string | null) || null;
  const email = args.email?.trim() || (contact?.email as string | null) || null;
  const phone = (contact?.phone as string | null) ?? null;

  // One row per contact and city: signing up again only refreshes it.
  const notes = args.notes?.trim() ?? "";
  const { data: existing } = await supabase
    .from("waitlist_entries")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("contact_id", ctx.contactId)
    .ilike("city", city)
    .maybeSingle();

  let entryId: string | null = (existing?.id as string | undefined) ?? null;
  if (entryId) {
    await supabase
      .from("waitlist_entries")
      .update({ name, email, phone, notes, status: "waiting", updated_at: new Date().toISOString() })
      .eq("id", entryId)
      .eq("workspace_id", ctx.workspaceId);
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("waitlist_entries")
      .insert({
        workspace_id: ctx.workspaceId,
        contact_id: ctx.contactId,
        conversation_id: ctx.conversationId,
        city,
        name,
        phone,
        email,
        notes,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      return {
        ok: false,
        output: null,
        error:
          "No se pudo guardar en la lista de espera. No le digas que ya está apuntado; dile que Antonio le escribirá.",
      };
    }
    entryId = inserted.id as string;
  }

  // HighLevel, best-effort: the list above is the record either way.
  let hlTagged = false;
  if (phone) {
    try {
      const cfg = await getHLConfig(ctx.workspaceId);
      if (cfg) {
        const hlId = await upsertHLContactByPhone(cfg, { name, phone, email });
        if (hlId) {
          await addHLTags(cfg, hlId, waitlistTags(city));
          hlTagged = true;
        }
      }
    } catch (err) {
      console.error("[join_waitlist] HighLevel tag failed:", err instanceof Error ? err.message : String(err));
    }
  }
  if (hlTagged && entryId) {
    await supabase.from("waitlist_entries").update({ hl_tagged: true }).eq("id", entryId);
  }

  // Google Sheet, best-effort: an Apps Script web app bound to the sheet
  // appends the row (tool config: sheet_webhook_url + sheet_webhook_token).
  await appendToSheet(supabase, ctx.workspaceId, {
    city,
    name,
    phone,
    email,
    notes,
    updated: Boolean(existing),
  });

  return {
    ok: true,
    output: {
      waitlist: true,
      city,
      message: `Apuntado en la lista de espera de ${city}. Confírmaselo y dile que le avisaréis en cuanto haya una edición en su ciudad.`,
    },
  };
}

async function appendToSheet(
  supabase: ReturnType<typeof svc>,
  workspaceId: string,
  row: {
    city: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    notes: string;
    updated: boolean;
  },
): Promise<void> {
  try {
    const { data } = await supabase
      .from("tool_configs")
      .select("config, tools!inner(key)")
      .eq("workspace_id", workspaceId)
      .eq("tools.key", "join_waitlist")
      .maybeSingle();
    const config = (data?.config ?? {}) as { sheet_webhook_url?: unknown; sheet_webhook_token?: unknown };
    const url = typeof config.sheet_webhook_url === "string" ? config.sheet_webhook_url : "";
    if (!url.startsWith("https://script.google.com/")) return;
    const res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: typeof config.sheet_webhook_token === "string" ? config.sheet_webhook_token : "",
        fecha: new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" }),
        ciudad: row.city,
        nombre: row.name ?? "",
        telefono: row.phone ?? "",
        email: row.email ?? "",
        notas: row.notes,
        estado: row.updated ? "En espera (actualizado)" : "En espera",
      }),
    });
    if (!res.ok) console.error("[join_waitlist] sheet append failed:", res.status);
  } catch (err) {
    console.error("[join_waitlist] sheet append error:", err instanceof Error ? err.message : String(err));
  }
}

export const joinWaitlistTool: Tool<Args> = {
  name: "join_waitlist",
  sensitivity: "read",
  description:
    "Apunta al cliente en la lista de espera de una ciudad, para avisarle cuando haya una nueva " +
    "edición allí. Úsala solo cuando ninguna de las próximas ediciones le encaja (ni por fecha ni " +
    "por ciudad) y ha aceptado quedar en la lista. Pasa la ciudad y, si los sabes, su nombre y email.",
  schema,
  enabledFor: () => true,
  run,
};
