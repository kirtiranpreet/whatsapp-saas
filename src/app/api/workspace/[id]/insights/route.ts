// Inteligencia de conversaciones — informes del workspace.
//   GET   → lista de informes + ajustes
//   POST  → "Analizar ahora" (informe manual de un periodo)
//   PATCH → activar/desactivar el informe semanal

import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { loadInsightsSettings, saveInsightsSettings, svc } from "@/features/insights/repo";
import { createReport, finalizeReports, processPending } from "@/features/insights/runner";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id: workspaceId } = await params;
  const auth = await requireWorkspaceMember(workspaceId);
  if (!auth.ok) return auth.response;
  try {
    const db = svc();
    const [settings, { data, error }] = await Promise.all([
      loadInsightsSettings(db, workspaceId),
      db
        .from("insight_reports")
        .select(
          "id, kind, period_start, period_end, time_zone, status, conversation_count, analyzed_count, failed_count, summary, error, created_at, completed_at",
        )
        .eq("workspace_id", workspaceId)
        .order("period_end", { ascending: false })
        .limit(60),
    ]);
    if (error) throw new Error(error.message);
    // Progreso de los informes en curso.
    const reports = data ?? [];
    const running = reports.filter((r) => r.status === "processing" || r.status === "finalizing");
    const progress: Record<string, number> = {};
    for (const r of running) {
      const { count } = await db
        .from("conversation_insights")
        .select("id", { count: "exact", head: true })
        .eq("report_id", r.id)
        .in("status", ["done", "failed"]);
      progress[r.id as string] = count ?? 0;
    }
    return NextResponse.json({ data: reports, progress, settings, role: auth.role });
  } catch (err) {
    console.error("[GET insights]", err);
    return NextResponse.json({ error: "No se pudieron cargar los informes" }, { status: 500 });
  }
}

const CreateSchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id: workspaceId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = CreateSchema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ error: "Periodo no válido" }, { status: 400 });

  const db = svc();
  try {
    const settings = await loadInsightsSettings(db, workspaceId);
    const end = Date.now();
    const start = end - parsed.data.days * 24 * 3600_000;
    const reportId = await createReport(db, {
      workspaceId,
      kind: "manual",
      periodStart: start,
      periodEnd: end,
      timeZone: settings.timeZone,
      createdBy: auth.userId,
    });
    if (!reportId) throw new Error("not_created");

    // Empieza ya; lo que no termine aquí lo sigue la tarea programada.
    after(async () => {
      const deadline = Date.now() + 270_000;
      await processPending(db, deadline, reportId);
      await finalizeReports(db, deadline, reportId);
    });
    return NextResponse.json({ data: { id: reportId } }, { status: 201 });
  } catch (err) {
    console.error("[POST insights]", err);
    return NextResponse.json({ error: "No se pudo iniciar el análisis" }, { status: 500 });
  }
}

const SettingsSchema = z.object({ weekly: z.boolean() });

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id: workspaceId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = SettingsSchema.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  try {
    await saveInsightsSettings(svc(), workspaceId, parsed.data.weekly);
    return NextResponse.json({ data: parsed.data });
  } catch (err) {
    console.error("[PATCH insights]", err);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
}
