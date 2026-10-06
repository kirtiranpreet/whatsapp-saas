// Contactos antiguos (tabla known_contacts): números que ya hablaban con el
// dueño antes del agente. Si uno de ellos abre una conversación nueva, la
// atiende una persona y el agente no contesta.
//
// Funciones puras arriba (se prueban con node --test); las que tocan la base
// de datos reciben el cliente.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone, phoneKey } from "../inbox/services/phone.ts";

export interface KnownContactInput {
  phone: string;
  name: string | null;
}

export interface ParsedKnownContact {
  phone: string;
  phone_key: string;
  name: string | null;
}

export interface ParseResult {
  contacts: ParsedKnownContact[];
  /** Líneas o teléfonos que no parecen un número válido. */
  invalid: number;
}

/** Máximo de contactos por importación (una agenda grande cabe de sobra). */
export const MAX_IMPORT = 20000;

/** Cuántos dígitos tiene un número válido (E.164: 15 como mucho). */
function validDigits(key: string): boolean {
  return /^[0-9]{6,15}$/.test(key);
}

function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = raw.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\s+/g, " ").trim();
  return name ? name.slice(0, 120) : null;
}

/**
 * Saca los teléfonos de una agenda exportada (.vcf), de un CSV o de una lista
 * pegada a mano (un número por línea, o separados por comas/punto y coma).
 *
 * `defaultCountryCode` es el prefijo del workspace, para los números guardados
 * sin él (p. ej. "34" si la agenda tiene "624 81 56 41").
 */
export function parseKnownContacts(
  text: string,
  defaultCountryCode?: string,
): ParseResult {
  const found: KnownContactInput[] = [];
  let invalid = 0;

  if (/BEGIN:VCARD/i.test(text)) {
    // vCard: una ficha por contacto, con FN (nombre) y una o más líneas TEL.
    // Las líneas largas pueden venir "dobladas" (siguen con un espacio).
    const unfolded = text.replace(/\r?\n[ \t]/g, "");
    for (const card of unfolded.split(/BEGIN:VCARD/i).slice(1)) {
      const lines = card.split(/\r?\n/);
      let name: string | null = null;
      const phones: string[] = [];
      for (const line of lines) {
        const sep = line.indexOf(":");
        if (sep < 0) continue;
        const key = line.slice(0, sep).toUpperCase();
        const value = line.slice(sep + 1).trim();
        if (key === "FN" || key.startsWith("FN;")) name = value;
        else if (!name && (key === "N" || key.startsWith("N;"))) {
          name = value.split(";").filter(Boolean).reverse().join(" ");
        } else if (key === "TEL" || key.startsWith("TEL;") || key.includes(".TEL")) {
          phones.push(value.replace(/^tel:/i, ""));
        }
      }
      for (const p of phones) found.push({ phone: p, name: cleanName(name) });
    }
  } else {
    // CSV o lista: cada línea puede traer nombre y teléfono; se toma como
    // teléfono el campo con más dígitos y como nombre el primer campo con letras.
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const fields = line
        .split(/[,;\t]/)
        .map((f) => f.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
      const phoneFields = fields.filter((f) => /^[+\d][\d\s\-().]{5,}$/.test(f));
      if (phoneFields.length === 0) {
        // Una cabecera ("Nombre,Teléfono") no cuenta como error.
        if (/\d/.test(line)) invalid++;
        continue;
      }
      const name = fields.find((f) => /[a-záéíóúñ]/i.test(f)) ?? null;
      for (const p of phoneFields) found.push({ phone: p, name: cleanName(name) });
    }
  }

  const byKey = new Map<string, ParsedKnownContact>();
  for (const { phone, name } of found) {
    const digits = phone.replace(/\D/g, "");
    if (!digits) {
      invalid++;
      continue;
    }
    const key = phoneKey(phone, defaultCountryCode);
    if (!validDigits(key)) {
      invalid++;
      continue;
    }
    const prev = byKey.get(key);
    if (!prev || (!prev.name && name)) {
      byKey.set(key, { phone: normalizePhone(phone, defaultCountryCode), phone_key: key, name });
    }
  }

  return { contacts: [...byKey.values()], invalid };
}

// ── Base de datos ─────────────────────────────────────────────────────────────

/** El prefijo por defecto del workspace (Negocio → país). */
export async function workspaceCountryCode(
  supabase: SupabaseClient,
  workspaceId: string,
  fallback: string,
): Promise<string> {
  const { data } = await supabase
    .from("business_info")
    .select("structured")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const cc = (data?.structured as { default_country_code?: string } | null)
    ?.default_country_code;
  return typeof cc === "string" && cc ? cc : fallback;
}

/** ¿Este número ya hablaba con el dueño antes del agente? */
export async function isKnownContact(
  supabase: SupabaseClient,
  workspaceId: string,
  key: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("known_contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("phone_key", key)
    .maybeSingle();
  if (error) {
    // Sin la tabla (migración sin aplicar) no se bloquea a nadie: se registra
    // y el contacto se trata como nuevo, igual que antes de este cambio.
    console.error("[known-contacts] lookup failed:", error.message);
    return false;
  }
  return Boolean(data);
}

/** Guarda contactos antiguos; los que ya estaban no se duplican. */
export async function addKnownContacts(
  supabase: SupabaseClient,
  workspaceId: string,
  contacts: ParsedKnownContact[],
  source: "import" | "history",
): Promise<void> {
  for (let i = 0; i < contacts.length; i += 500) {
    const chunk = contacts.slice(i, i + 500).map((c) => ({
      workspace_id: workspaceId,
      phone_key: c.phone_key,
      phone: c.phone,
      name: c.name,
      source,
    }));
    const { error } = await supabase
      .from("known_contacts")
      .upsert(chunk, { onConflict: "workspace_id,phone_key", ignoreDuplicates: true });
    if (error) throw new Error(`[known-contacts] insert failed: ${error.message}`);
  }
}

export interface KnownContactsSummary {
  total: number;
  imported: number;
  fromHistory: number;
}

export async function knownContactsSummary(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<KnownContactsSummary> {
  const count = async (source?: "import" | "history") => {
    let q = supabase
      .from("known_contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    if (source) q = q.eq("source", source);
    const { count: n, error } = await q;
    if (error) throw new Error(`[known-contacts] count failed: ${error.message}`);
    return n ?? 0;
  };
  const [total, imported, fromHistory] = await Promise.all([
    count(),
    count("import"),
    count("history"),
  ]);
  return { total, imported, fromHistory };
}

/** Busca en la lista (para comprobar un número concreto). */
export async function findKnownContact(
  supabase: SupabaseClient,
  workspaceId: string,
  key: string,
): Promise<{ phone: string; name: string | null; source: string } | null> {
  const { data } = await supabase
    .from("known_contacts")
    .select("phone, name, source")
    .eq("workspace_id", workspaceId)
    .eq("phone_key", key)
    .maybeSingle();
  return (data as { phone: string; name: string | null; source: string } | null) ?? null;
}

export async function removeKnownContact(
  supabase: SupabaseClient,
  workspaceId: string,
  key: string,
): Promise<void> {
  const { error } = await supabase
    .from("known_contacts")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("phone_key", key);
  if (error) throw new Error(`[known-contacts] delete failed: ${error.message}`);
}

/** Vacía la lista importada (los del historial de Kapso se quedan). */
export async function clearImportedKnownContacts(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  const { error } = await supabase
    .from("known_contacts")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("source", "import");
  if (error) throw new Error(`[known-contacts] clear failed: ${error.message}`);
}
