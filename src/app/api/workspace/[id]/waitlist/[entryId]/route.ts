// Lista de espera — marcar como avisado / quitar una entrada.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient as createSbClient } from "@supabase/supabase-js";
import {
  readJsonBody,
  requireWorkspaceMember,
} from "@/lib/auth/workspace-access";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const PatchSchema = z.object({ status: z.enum(["waiting", "notified"]) });

type Ctx = { params: Promise<{ id: string; entryId: string }> };

// ── PATCH /api/workspace/[id]/waitlist/[entryId] ─────────────────────────────
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id: workspaceId, entryId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = PatchSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Estado no válido" }, { status: 400 });
  }

  const { data, error } = await svc()
    .from("waitlist_entries")
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// ── DELETE /api/workspace/[id]/waitlist/[entryId] ────────────────────────────
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id: workspaceId, entryId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const { error } = await svc()
    .from("waitlist_entries")
    .delete()
    .eq("id", entryId)
    .eq("workspace_id", workspaceId);
  if (error) {
    return NextResponse.json({ error: "No se pudo quitar" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
