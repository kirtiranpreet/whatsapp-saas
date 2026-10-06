// Oportunidades calientes y seguimientos pendientes (cálculo al momento).

import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { loadFollowUps } from "@/features/insights/opportunities";
import { svc } from "@/features/insights/repo";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id: workspaceId } = await params;
  const auth = await requireWorkspaceMember(workspaceId);
  if (!auth.ok) return auth.response;
  try {
    const items = await loadFollowUps(svc(), workspaceId);
    return NextResponse.json({ data: items, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error("[GET insights/followups]", err);
    return NextResponse.json({ error: "No se pudieron cargar los seguimientos" }, { status: 500 });
  }
}
