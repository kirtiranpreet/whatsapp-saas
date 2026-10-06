// "¿Qué debería responder?" — propone una respuesta. Nunca la envía.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { svc } from "@/features/insights/repo";
import { suggestReply } from "@/features/insights/reply";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ conversationId: z.string().uuid() });

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id: workspaceId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "agent" });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = Body.safeParse(body.body);
  if (!parsed.success) return NextResponse.json({ error: "Conversación no válida" }, { status: 400 });
  try {
    const reply = await suggestReply(svc(), workspaceId, parsed.data.conversationId);
    if (!reply) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    return NextResponse.json({ data: reply });
  } catch (err) {
    console.error("[POST insights/reply]", err);
    return NextResponse.json({ error: "No se pudo generar la respuesta" }, { status: 502 });
  }
}
