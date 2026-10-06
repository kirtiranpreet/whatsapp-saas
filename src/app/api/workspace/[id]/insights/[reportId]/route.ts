// Un informe: detalle completo (GET) y borrado (DELETE, en cascada).

import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { svc } from "@/features/insights/repo";

type Ctx = { params: Promise<{ id: string; reportId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id: workspaceId, reportId } = await params;
  const auth = await requireWorkspaceMember(workspaceId);
  if (!auth.ok) return auth.response;
  const { data, error } = await svc()
    .from("insight_reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", reportId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "No se pudo cargar el informe" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Informe no encontrado" }, { status: 404 });
  return NextResponse.json({ data, role: auth.role });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id: workspaceId, reportId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;
  const { data, error } = await svc()
    .from("insight_reports")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", reportId)
    .select("id");
  if (error) return NextResponse.json({ error: "No se pudo eliminar" }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Informe no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
