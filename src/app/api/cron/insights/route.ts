import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { svc } from "@/features/insights/repo";
import { tick } from "@/features/insights/runner";

// ──────────────────────────────────────────────────────────────────────────────
// Inteligencia de conversaciones — llamado cada 5 minutos por pg_cron (job
// `insights-tick`, ver supabase/cron/schedule-insights.sql) con
// `Authorization: Bearer ${CRON_SECRET}`.
// Crea el informe semanal cuando toca y avanza el análisis por tandas.
// ──────────────────────────────────────────────────────────────────────────────

export const maxDuration = 300;
const BUDGET_MS = 250_000;

function isAuthorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(header);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request.headers.get("Authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await tick(svc(), BUDGET_MS);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    console.error("[cron/insights]", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
