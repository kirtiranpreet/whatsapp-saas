// Biblioteca de archivos del agente — URL firmada para subir un archivo.
//
// El navegador sube directo a Supabase Storage con esta URL (sin pasar por
// Vercel, que limita los cuerpos a 4,5 MB) y después registra el archivo con
// POST /api/workspace/[id]/files.

import { randomUUID } from "node:crypto";
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
} from "@/features/agent-files/service";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const RequestSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

// ── POST /api/workspace/[id]/files/upload-url ────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = RequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos del archivo no válidos" }, { status: 400 });
  }

  const check = checkAgentFile(parsed.data.mimeType, parsed.data.sizeBytes);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const fileId = randomUUID();
  const path = agentFileStoragePath(workspaceId, fileId, parsed.data.filename);
  const { data, error } = await svc()
    .storage.from(AGENT_FILES_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("[POST /api/workspace/[id]/files/upload-url]:", error?.message);
    return NextResponse.json(
      { error: "No se pudo preparar la subida" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: { fileId, path: data.path, token: data.token, mimeType: check.mime },
  });
}
