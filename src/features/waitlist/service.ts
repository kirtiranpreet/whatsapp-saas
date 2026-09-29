// Lista de espera por ciudad (tabla waitlist_entries). Funciones puras aquí
// arriba; las que tocan la base de datos reciben el cliente.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface WaitlistEntry {
  id: string;
  city: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  notes: string;
  status: "waiting" | "notified";
  hl_tagged: boolean;
  created_at: string;
}

/** "La Coruña" → "la-coruna": para la etiqueta de GHL. */
export function citySlug(city: string): string {
  return city
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "zaragoza " → "Zaragoza"; "la coruña" → "La Coruña". */
export function normalizeCity(city: string): string {
  const clean = city.replace(/[%_]/g, "").trim().replace(/\s+/g, " ");
  return clean
    .split(" ")
    .map((w, i) =>
      i > 0 && ["de", "del", "la", "las", "el", "los", "y"].includes(w.toLowerCase())
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(" ");
}

export function waitlistTags(city: string): string[] {
  const slug = citySlug(city);
  return slug ? ["lista-espera", `lista-espera-${slug}`] : ["lista-espera"];
}

function csvCell(v: string | null | undefined): string {
  const s = (v ?? "").replace(/\r?\n/g, " ");
  return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV para Excel/Google Sheets (con BOM para que respete los acentos). */
export function waitlistCsv(entries: WaitlistEntry[]): string {
  const head = ["Ciudad", "Nombre", "Teléfono", "Email", "Notas", "Estado", "Fecha"];
  const rows = entries.map((e) =>
    [
      e.city,
      e.name,
      e.phone,
      e.email,
      e.notes,
      e.status === "notified" ? "Avisado" : "En espera",
      e.created_at.slice(0, 10),
    ]
      .map(csvCell)
      .join(","),
  );
  return "﻿" + [head.join(","), ...rows].join("\r\n") + "\r\n";
}

export async function listWaitlist(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WaitlistEntry[]> {
  const { data, error } = await supabase
    .from("waitlist_entries")
    .select("id, city, name, phone, email, notes, status, hl_tagged, created_at")
    .eq("workspace_id", workspaceId)
    .order("city", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as WaitlistEntry[];
}
