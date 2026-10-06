// Contenido generado desde un grupo del informe (pregunta, objeción…).
//   GET  → contenido ya generado para este informe
//   POST → generar nuevo contenido desde { kind, key }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { buildBusinessInfoContext, getBusinessInfo } from "@/features/inbox/services/business-info";
import type { ReportStats } from "@/features/insights/aggregate";
import { generateContent, resolveSource } from "@/features/insights/content";
import { svc } from "@/features/insights/repo";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string; reportId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id: workspaceId, reportId } = await params;
  const auth = await requireWorkspaceMember(workspaceId);
  if (!auth.ok) return auth.response;
  const { data, error } = await svc()
    .from("insight_content")
    .select("id, source, content, created_at")
    .eq("workspace_id", workspaceId)
    .eq("report_id", reportId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: "No se pudo cargar" }, { status: 500 });
  return NextResponse.json({ data });
}

const Body = z.object({
  kind: z.enum(["faq", "objection", "non_buying", "motivation", "language"]),
  key: z.string().min(1).max(200),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id: workspaceId, reportId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = Body.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

  const db = svc();
  const { data: report } = await db
    .from("insight_reports")
    .select("stats, status")
    .eq("workspace_id", workspaceId)
    .eq("id", reportId)
    .maybeSingle();
  if (!report || report.status !== "ready") {
    return NextResponse.json({ error: "El informe no está listo" }, { status: 409 });
  }
  const source = resolveSource(report.stats as ReportStats, parsed.data.kind, parsed.data.key);
  if (!source || source.quotes.length === 0) {
    return NextResponse.json({ error: "No hay frases reales suficientes para este grupo" }, { status: 422 });
  }

  try {
    const offerContext = buildBusinessInfoContext(await getBusinessInfo(workspaceId)).slice(0, 6000);
    const content = await generateContent({ workspaceId, source, offerContext });
    const { data, error } = await db
      .from("insight_content")
      .insert({ workspace_id: workspaceId, report_id: reportId, source, content, created_by: auth.userId })
      .select("id, source, content, created_at")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error("[POST insights/content]", err);
    return NextResponse.json({ error: "No se pudo generar el contenido" }, { status: 502 });
  }
}
