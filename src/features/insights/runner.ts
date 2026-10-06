// Orquestación de los informes. Funciona por tandas para escalar a cientos o
// miles de conversaciones sin pasarse del tiempo de una función de Vercel:
//
//   1. createReport  → crea el informe y una fila "pending" por conversación.
//   2. processPending → analiza conversaciones (varias en paralelo) hasta el
//      límite de tiempo. Lo que no termina queda para la siguiente tanda.
//   3. finalizeReports → cuando no queda nada pendiente: agrupa etiquetas,
//      calcula agregados, compara con el informe anterior y genera
//      recomendaciones.
//
// La tarea programada (cada 5 min) llama a `tick`, que además crea el informe
// semanal cuando toca. "Analizar ahora" llama a las mismas funciones.

import { getActiveAgent } from "@/features/agents/services/active-agent";
import { aggregate, type AnalyzedConversation, type ReportStats } from "./aggregate";
import { clusterLabels } from "./cluster";
import { compareStats } from "./evolution";
import { extractConversation } from "./extract";
import { insightsModel } from "./llm";
import { lastFullWeek, weeklyReportDue } from "./period";
import { recommend } from "./recommend";
import {
  agentConversationIds,
  conversationContext,
  conversationMessages,
  loadInsightsSettings,
  type Db,
} from "./repo";
import type { VerifiedExtraction } from "./schema";
import { buildTranscript } from "./transcript";

const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;
const STALE_MS = 10 * 60_000;
/** Margen para no empezar un análisis que no da tiempo a terminar. */
const PER_ITEM_RESERVE_MS = 90_000;

export interface CreateReportInput {
  workspaceId: string;
  kind: "weekly" | "manual";
  periodStart: number;
  periodEnd: number;
  timeZone: string;
  createdBy: string | null;
}

export async function createReport(db: Db, input: CreateReportInput): Promise<string | null> {
  const from = new Date(input.periodStart).toISOString();
  const to = new Date(input.periodEnd).toISOString();
  const { data: report, error } = await db
    .from("insight_reports")
    .insert({
      workspace_id: input.workspaceId,
      kind: input.kind,
      period_start: from,
      period_end: to,
      time_zone: input.timeZone,
      status: "processing",
      model: insightsModel(),
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) {
    // 23505: ya existe el informe semanal de esa semana.
    if (error.code === "23505") return null;
    throw new Error(`create_report: ${error.message}`);
  }
  const reportId = report.id as string;

  try {
    const ids = await agentConversationIds(db, input.workspaceId, from, to);
    for (let i = 0; i < ids.length; i += 500) {
      const rows = ids.slice(i, i + 500).map((conversation_id) => ({
        workspace_id: input.workspaceId,
        report_id: reportId,
        conversation_id,
      }));
      const { error: insErr } = await db.from("conversation_insights").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
    await db.from("insight_reports").update({ conversation_count: ids.length }).eq("id", reportId);
  } catch (err: unknown) {
    await db
      .from("insight_reports")
      .update({ status: "failed", error: err instanceof Error ? err.message.slice(0, 300) : "error" })
      .eq("id", reportId);
    throw err;
  }
  return reportId;
}

interface InsightRow {
  id: string;
  workspace_id: string;
  report_id: string;
  conversation_id: string;
  attempts: number;
}

/** Reserva una conversación pendiente (o atascada) para analizarla. */
async function claimNext(db: Db, reportId?: string): Promise<InsightRow | null> {
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  for (let tries = 0; tries < 5; tries++) {
    let q = db
      .from("conversation_insights")
      .select("id, workspace_id, report_id, conversation_id, attempts, status, claimed_at")
      .or(`status.eq.pending,and(status.eq.processing,claimed_at.lt.${staleBefore})`)
      .order("created_at", { ascending: true })
      .limit(1);
    if (reportId) q = q.eq("report_id", reportId);
    const { data } = await q;
    const row = data?.[0] as (InsightRow & { status: string; claimed_at: string | null }) | undefined;
    if (!row) return null;

    if (row.attempts >= MAX_ATTEMPTS) {
      await db
        .from("conversation_insights")
        .update({ status: "failed", error: "Demasiados intentos" })
        .eq("id", row.id)
        .eq("status", row.status);
      continue;
    }

    let upd = db
      .from("conversation_insights")
      .update({ status: "processing", claimed_at: new Date().toISOString(), attempts: row.attempts + 1 })
      .eq("id", row.id)
      .eq("status", row.status);
    upd = row.claimed_at ? upd.eq("claimed_at", row.claimed_at) : upd.is("claimed_at", null);
    const { data: claimed } = await upd.select("id");
    if (claimed && claimed.length > 0) return { ...row, attempts: row.attempts + 1 };
  }
  return null;
}

const agentNames = new Map<string, string>();
async function agentNameFor(workspaceId: string): Promise<string> {
  if (!agentNames.has(workspaceId)) {
    const agent = await getActiveAgent(workspaceId);
    agentNames.set(workspaceId, agent?.name?.trim() || "el agente");
  }
  return agentNames.get(workspaceId)!;
}

/** Hubo algún seguimiento automático (batch de seguimiento) antes del cierre del periodo. */
async function hadFollowUp(db: Db, workspaceId: string, conversationId: string, until: string): Promise<boolean> {
  const { count } = await db
    .from("message_batches")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .not("meta->follow_up", "is", null)
    .lt("created_at", until);
  return (count ?? 0) > 0;
}

async function analyzeOne(db: Db, row: InsightRow): Promise<void> {
  try {
    const { data: report } = await db
      .from("insight_reports")
      .select("period_end")
      .eq("id", row.report_id)
      .maybeSingle();
    if (!report) return; // el informe se borró mientras tanto

    const ctx = await conversationContext(db, row.workspace_id, row.conversation_id);
    if (!ctx) throw new Error("La conversación ya no existe");
    const messages = await conversationMessages(db, row.workspace_id, row.conversation_id, report.period_end as string);
    const lines = buildTranscript(messages);
    if (!lines.some((l) => l.speaker === "cliente")) throw new Error("Sin mensajes del cliente");

    const result = await extractConversation({
      workspaceId: row.workspace_id,
      lines,
      facts: ctx.facts,
      agentName: await agentNameFor(row.workspace_id),
    });

    const first = lines[0]?.at;
    const last = lines[lines.length - 1]?.at;
    const metrics = {
      messages: lines.length,
      customer_messages: lines.filter((l) => l.speaker === "cliente").length,
      agent_messages: lines.filter((l) => l.speaker === "agente").length,
      duration_hours:
        first && last ? Math.round(((Date.parse(last) - Date.parse(first)) / 3600_000) * 10) / 10 : 0,
      had_follow_up: await hadFollowUp(db, row.workspace_id, row.conversation_id, report.period_end as string),
    };

    await db
      .from("conversation_insights")
      .update({
        status: "done",
        message_count: lines.length,
        extraction: { ...result.extraction, contact: ctx.label, metrics },
        dropped: result.dropped,
        error: null,
      })
      .eq("id", row.id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "error";
    console.error("[insights] analyze failed:", row.conversation_id, message);
    await db
      .from("conversation_insights")
      .update({ status: row.attempts >= MAX_ATTEMPTS ? "failed" : "pending", error: message, claimed_at: null })
      .eq("id", row.id);
  }
}

export async function processPending(db: Db, deadline: number, reportId?: string): Promise<number> {
  let done = 0;
  const worker = async () => {
    while (Date.now() + PER_ITEM_RESERVE_MS < deadline) {
      const row = await claimNext(db, reportId);
      if (!row) return;
      await analyzeOne(db, row);
      done += 1;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return done;
}

type StoredExtraction = VerifiedExtraction & {
  contact?: string;
  metrics?: AnalyzedConversation["metrics"];
};

async function loadAnalyzed(db: Db, reportId: string): Promise<{ items: AnalyzedConversation[]; failed: number }> {
  const items: AnalyzedConversation[] = [];
  let failed = 0;
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .from("conversation_insights")
      .select("conversation_id, status, extraction")
      .eq("report_id", reportId)
      .order("created_at", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      if (r.status === "done" && r.extraction) {
        const x = r.extraction as StoredExtraction;
        items.push({
          conversationId: r.conversation_id as string,
          contactLabel: x.contact ?? "Contacto",
          extraction: x,
          metrics: x.metrics ?? {
            messages: 0,
            customer_messages: 0,
            agent_messages: 0,
            duration_hours: 0,
            had_follow_up: false,
          },
        });
      } else if (r.status === "failed") {
        failed += 1;
      }
    }
    if ((data ?? []).length < 500) break;
  }
  return { items, failed };
}

/** Etiquetas ordenadas por frecuencia (las más repetidas primero). */
function byFrequency(labels: string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
}

export async function finalizeReport(db: Db, reportId: string): Promise<void> {
  const { data: report } = await db
    .from("insight_reports")
    .select("id, workspace_id, kind, period_start, conversation_count")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return;
  const workspaceId = report.workspace_id as string;

  try {
    const { items, failed } = await loadAnalyzed(db, reportId);
    const xs = items.map((i) => i.extraction);
    const [faqMap, motivationMap, topicMap, themeMap] = await Promise.all([
      clusterLabels({ workspaceId, kind: "preguntas de clientes", labels: byFrequency(xs.flatMap((x) => x.questions.map((q) => q.normalized))) }),
      clusterLabels({ workspaceId, kind: "motivos de compra", labels: byFrequency(xs.flatMap((x) => x.buying_motivations.map((m) => m.label))) }),
      clusterLabels({ workspaceId, kind: "temas de conversación", labels: byFrequency(xs.flatMap((x) => x.topics)) }),
      clusterLabels({ workspaceId, kind: "temas del lenguaje del cliente", labels: byFrequency(xs.flatMap((x) => x.customer_language.map((c) => c.theme))) }),
    ]);

    const stats: ReportStats & { evolution?: unknown } = aggregate(items, {
      totalConversations: (report.conversation_count as number) ?? items.length + failed,
      failed,
      faqMap,
      motivationMap,
      topicMap,
      themeMap,
    });

    // Evolución: el informe listo anterior del mismo tipo.
    const { data: prev } = await db
      .from("insight_reports")
      .select("id, stats")
      .eq("workspace_id", workspaceId)
      .eq("kind", report.kind as string)
      .eq("status", "ready")
      .lt("period_start", report.period_start as string)
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prev?.stats && (prev.stats as ReportStats).totals) {
      stats.evolution = compareStats(stats, prev.stats as ReportStats, prev.id as string);
    }

    let summary: string | null = null;
    let recommendations: unknown[] = [];
    let recError: string | null = null;
    try {
      const rec = await recommend({ workspaceId, stats });
      summary = rec.summary;
      recommendations = rec.recommendations;
    } catch (err: unknown) {
      // Los datos siguen siendo válidos sin recomendaciones.
      recError = err instanceof Error ? err.message.slice(0, 300) : "error";
    }

    await db
      .from("insight_reports")
      .update({
        status: "ready",
        stats,
        summary,
        recommendations,
        analyzed_count: items.length,
        failed_count: failed,
        error: recError ? `Recomendaciones no disponibles: ${recError}` : null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", reportId);
  } catch (err: unknown) {
    await db
      .from("insight_reports")
      .update({ status: "failed", error: err instanceof Error ? err.message.slice(0, 300) : "error" })
      .eq("id", reportId);
  }
}

/** Cierra los informes que ya no tienen conversaciones por analizar. */
export async function finalizeReports(db: Db, deadline: number, reportId?: string): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  let q = db
    .from("insight_reports")
    .select("id, status, finalizing_since")
    .or(`status.eq.processing,and(status.eq.finalizing,finalizing_since.lt.${staleBefore})`)
    .order("created_at", { ascending: true })
    .limit(10);
  if (reportId) q = q.eq("id", reportId);
  const { data: reports } = await q;
  let finalized = 0;
  for (const r of reports ?? []) {
    if (Date.now() + PER_ITEM_RESERVE_MS > deadline) break;
    const { count } = await db
      .from("conversation_insights")
      .select("id", { count: "exact", head: true })
      .eq("report_id", r.id)
      .in("status", ["pending", "processing"]);
    if ((count ?? 0) > 0) continue;
    const { data: claimed } = await db
      .from("insight_reports")
      .update({ status: "finalizing", finalizing_since: new Date().toISOString() })
      .eq("id", r.id)
      .eq("status", r.status)
      .select("id");
    if (!claimed || claimed.length === 0) continue;
    await finalizeReport(db, r.id as string);
    finalized += 1;
  }
  return finalized;
}

/** Crea el informe semanal de cada workspace que lo tiene activado y le toca. */
export async function ensureWeeklyReports(db: Db, now: number): Promise<number> {
  const { data: workspaces } = await db
    .from("workspaces")
    .select("id, settings")
    .eq("is_active", true);
  let created = 0;
  for (const ws of workspaces ?? []) {
    const settings = (ws.settings ?? {}) as { insights?: { weekly?: unknown } };
    if (settings.insights?.weekly !== true) continue;
    const cfg = await loadInsightsSettings(db, ws.id as string);
    if (!weeklyReportDue(now, cfg.timeZone)) continue;
    const week = lastFullWeek(now, cfg.timeZone);
    const { data: existing } = await db
      .from("insight_reports")
      .select("id")
      .eq("workspace_id", ws.id)
      .eq("kind", "weekly")
      .eq("period_start", new Date(week.start).toISOString())
      .maybeSingle();
    if (existing) continue;
    try {
      const id = await createReport(db, {
        workspaceId: ws.id as string,
        kind: "weekly",
        periodStart: week.start,
        periodEnd: week.end,
        timeZone: cfg.timeZone,
        createdBy: null,
      });
      if (id) created += 1;
    } catch (err: unknown) {
      console.error("[insights] weekly report failed:", ws.id, err instanceof Error ? err.message : "error");
    }
  }
  return created;
}

export async function tick(db: Db, budgetMs: number): Promise<{ created: number; analyzed: number; finalized: number }> {
  const deadline = Date.now() + budgetMs;
  const created = await ensureWeeklyReports(db, Date.now());
  const analyzed = await processPending(db, deadline);
  const finalized = await finalizeReports(db, deadline);
  return { created, analyzed, finalized };
}
