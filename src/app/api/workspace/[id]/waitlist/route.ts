// Lista de espera — listado (JSON) y descarga (?format=csv).

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { listWaitlist, waitlistCsv } from "@/features/waitlist/service";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── GET /api/workspace/[id]/waitlist[?format=csv] ────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;
  const auth = await requireWorkspaceMember(workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const entries = await listWaitlist(svc(), workspaceId);
    if (req.nextUrl.searchParams.get("format") === "csv") {
      return new NextResponse(waitlistCsv(entries), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="lista-de-espera.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json({ data: entries });
  } catch (err) {
    console.error("[GET /api/workspace/[id]/waitlist]:", err);
    return NextResponse.json(
      { error: "No se pudo cargar la lista de espera" },
      { status: 500 },
    );
  }
}
