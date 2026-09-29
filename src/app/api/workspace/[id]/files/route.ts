// Biblioteca de archivos del agente — lista y alta.
//
// La subida va directa del navegador a Supabase Storage con una URL firmada
// (upload-url/route.ts): una función de Vercel no acepta cuerpos de más de
// 4,5 MB, y un audio o un PDF los superan. Aquí solo se registra el archivo
// una vez subido.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient as createSbClient } from "@supabase/supabase-js";
import {
  readJsonBody,
  requireWorkspaceMember,
} from "@/lib/auth/workspace-access";
import {
  AGENT_FILES_BUCKET,
  agentFileStoragePath,
  checkAgentFile,
  listAgentFiles,
} from "@/features/agent-files/service";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const CreateSchema = z.object({
  fileId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

// ── GET /api/workspace/[id]/files ────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;
  const auth = await requireWorkspaceMember(workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const files = await listAgentFiles(svc(), workspaceId);
    return NextResponse.json({ data: files });
  } catch (err) {
    console.error("[GET /api/workspace/[id]/files]:", err);
    return NextResponse.json(
      { error: "No se pudieron cargar los archivos" },
      { status: 500 },
    );
  }
}

// ── POST /api/workspace/[id]/files ───────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = CreateSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos del archivo no válidos" }, { status: 400 });
  }
  const { fileId, name, description, filename, mimeType, sizeBytes } = parsed.data;

  const check = checkAgentFile(mimeType, sizeBytes);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const db = svc();
  const storagePath = agentFileStoragePath(workspaceId, fileId, filename);

  // The file must really be in storage, at the path this workspace owns: the
  // row is what the agent sends, so it never points at a missing object.
  const folder = `${workspaceId}/${fileId}`;
  const objectName = storagePath.slice(folder.length + 1);
  const { data: objects, error: listError } = await db.storage
    .from(AGENT_FILES_BUCKET)
    .list(folder, { search: objectName });
  if (listError || !(objects ?? []).some((o) => o.name === objectName)) {
    return NextResponse.json(
      { error: "No se encontró el archivo subido. Vuelve a intentarlo." },
      { status: 400 },
    );
  }

  const { data, error } = await db
    .from("agent_files")
    .insert({
      id: fileId,
      workspace_id: workspaceId,
      name,
      description,
      kind: check.kind,
      mime_type: check.mime,
      filename,
      size_bytes: sizeBytes,
      storage_path: storagePath,
      created_by: auth.userId,
    })
    .select(
      "id, workspace_id, name, description, kind, mime_type, filename, size_bytes, storage_path, created_at",
    )
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya hay un archivo con ese nombre. Elige otro nombre." },
        { status: 409 },
      );
    }
    console.error("[POST /api/workspace/[id]/files]:", error.message);
    return NextResponse.json({ error: "No se pudo guardar el archivo" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
