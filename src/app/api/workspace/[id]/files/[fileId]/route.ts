// Biblioteca de archivos del agente — editar nombre/descripción y borrar.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient as createSbClient } from "@supabase/supabase-js";
import {
  readJsonBody,
  requireWorkspaceMember,
} from "@/lib/auth/workspace-access";
import {
  AGENT_FILES_BUCKET,
  getAgentFile,
} from "@/features/agent-files/service";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined);

type Params = { params: Promise<{ id: string; fileId: string }> };

// ── PATCH /api/workspace/[id]/files/[fileId] ─────────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: workspaceId, fileId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = PatchSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  }

  const { data, error } = await svc()
    .from("agent_files")
    .update(parsed.data)
    .eq("workspace_id", workspaceId)
    .eq("id", fileId)
    .select(
      "id, workspace_id, name, description, kind, mime_type, filename, size_bytes, storage_path, created_at",
    )
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya hay un archivo con ese nombre. Elige otro nombre." },
        { status: 409 },
      );
    }
    console.error("[PATCH /api/workspace/[id]/files/[fileId]]:", error.message);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ data });
}

// ── DELETE /api/workspace/[id]/files/[fileId] ────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id: workspaceId, fileId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const db = svc();
  let file;
  try {
    file = await getAgentFile(db, workspaceId, fileId);
  } catch (err) {
    console.error("[DELETE /api/workspace/[id]/files/[fileId]]:", err);
    return NextResponse.json({ error: "No se pudo borrar" }, { status: 500 });
  }
  if (!file) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }

  const { error } = await db
    .from("agent_files")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", fileId);
  if (error) {
    console.error("[DELETE /api/workspace/[id]/files/[fileId]]:", error.message);
    return NextResponse.json({ error: "No se pudo borrar" }, { status: 500 });
  }

  // Messages already sent keep pointing at this object (the inbox shows
  // them), so the file itself stays in storage: only the library entry goes.
  return NextResponse.json({ ok: true });
}
