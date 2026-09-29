// Voces de ElevenLabs para elegir la del agente (Configurar agente → Voz).

import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import {
  elevenLabsApiKey,
  listElevenLabsVoices,
  ElevenLabsError,
} from "@/features/voice/elevenlabs";

// ── GET /api/workspace/[id]/voices ───────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const apiKey = elevenLabsApiKey();
  if (!apiKey) {
    return NextResponse.json({ data: [], configured: false });
  }

  try {
    const voices = await listElevenLabsVoices(apiKey);
    return NextResponse.json({ data: voices, configured: true });
  } catch (err) {
    console.error("[GET /api/workspace/[id]/voices]:", err);
    const unauthorized = err instanceof ElevenLabsError && err.status === 401;
    return NextResponse.json(
      {
        error: unauthorized
          ? "ElevenLabs rechazó la clave. Revisa ELEVENLABS_API_KEY en Vercel."
          : "No se pudieron cargar las voces de ElevenLabs",
      },
      { status: 502 },
    );
  }
}
