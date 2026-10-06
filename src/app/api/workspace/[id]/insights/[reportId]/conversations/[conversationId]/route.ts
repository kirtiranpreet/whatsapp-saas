// Análisis de una conversación dentro de un informe: la extracción con su
// evidencia (ids de mensajes), para "Ver evidencia" y el timeline.

import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { svc } from "@/features/insights/repo";

type Ctx = { params: Promise<{ id: string; reportId: string; conversationId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id: workspaceId, reportId, conversationId } = await params;
  const auth = await requireWorkspaceMember(workspaceId);
  if (!auth.ok) return auth.response;
  const { data, error } = await svc()
    .from("conversation_insights")
    .select("conversation_id, status, extraction, dropped, error, message_count, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("report_id", reportId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "No se pudo cargar" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ data });
}
