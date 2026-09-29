// Biblioteca de archivos del agente: PDF, audios, vídeos e imágenes que el
// agente puede enviar por WhatsApp con la tool send_file.
//
// Los archivos viven en el bucket privado whatsapp-media con la ruta
// {workspace_id}/{file_id}/{nombre} (la forma de media-handler), así el inbox
// los muestra con /api/inbox/media-url sin cambios.

import type { SupabaseClient } from "@supabase/supabase-js";

export const AGENT_FILES_BUCKET = "whatsapp-media";

export type AgentFileKind = "document" | "audio" | "video" | "image";

export interface AgentFile {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  kind: AgentFileKind;
  mime_type: string;
  filename: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

const MB = 1024 * 1024;

/**
 * Tipos que WhatsApp acepta y el tamaño máximo de cada uno. Los límites son
 * los de WhatsApp (imagen 5 MB, audio y vídeo 16 MB); el de los documentos
 * lo pone el bucket (50 MB), por debajo de los 100 MB de WhatsApp.
 */
export const ACCEPTED_MIME_TYPES: Record<string, { kind: AgentFileKind; maxBytes: number }> = {
  "application/pdf": { kind: "document", maxBytes: 50 * MB },
  "application/msword": { kind: "document", maxBytes: 50 * MB },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    kind: "document",
    maxBytes: 50 * MB,
  },
  "audio/mpeg": { kind: "audio", maxBytes: 16 * MB },
  "audio/mp4": { kind: "audio", maxBytes: 16 * MB },
  "audio/aac": { kind: "audio", maxBytes: 16 * MB },
  "audio/ogg": { kind: "audio", maxBytes: 16 * MB },
  "video/mp4": { kind: "video", maxBytes: 16 * MB },
  "video/3gpp": { kind: "video", maxBytes: 16 * MB },
  "image/jpeg": { kind: "image", maxBytes: 5 * MB },
  "image/png": { kind: "image", maxBytes: 5 * MB },
};

/** Lo que el navegador informa a veces para un .m4a o .mp3. */
const MIME_ALIASES: Record<string, string> = {
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/mp3": "audio/mpeg",
  "image/jpg": "image/jpeg",
};

export function normalizeMime(mime: string): string {
  const lower = mime.toLowerCase().split(";")[0].trim();
  return MIME_ALIASES[lower] ?? lower;
}

export type FileCheck =
  | { ok: true; kind: AgentFileKind; mime: string }
  | { ok: false; error: string };

/** Valida tipo y tamaño antes de subir. Mensajes en español para el equipo. */
export function checkAgentFile(mime: string, sizeBytes: number): FileCheck {
  const normalized = normalizeMime(mime);
  const rule = ACCEPTED_MIME_TYPES[normalized];
  if (!rule) {
    return {
      ok: false,
      error:
        "Formato no admitido. Usa PDF o Word, audio MP3/M4A/OGG, vídeo MP4 o imagen JPG/PNG.",
    };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: "El archivo está vacío." };
  }
  if (sizeBytes > rule.maxBytes) {
    return {
      ok: false,
      error: `El archivo pesa más de ${Math.round(rule.maxBytes / MB)} MB, el máximo que WhatsApp permite para este tipo.`,
    };
  }
  return { ok: true, kind: rule.kind, mime: normalized };
}

/** Nombre de archivo seguro para la ruta de storage (la regex de media-url). */
export function safeStorageName(filename: string): string {
  const cleaned = filename
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(-100);
  return cleaned || "archivo";
}

export function agentFileStoragePath(
  workspaceId: string,
  fileId: string,
  filename: string,
): string {
  return `${workspaceId}/${fileId}/${safeStorageName(filename)}`;
}

const COLUMNS =
  "id, workspace_id, name, description, kind, mime_type, filename, size_bytes, storage_path, created_at";

export async function listAgentFiles(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<AgentFile[]> {
  const { data, error } = await supabase
    .from("agent_files")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`[agent-files] list failed: ${error.message}`);
  return (data ?? []) as AgentFile[];
}

export async function getAgentFile(
  supabase: SupabaseClient,
  workspaceId: string,
  fileId: string,
): Promise<AgentFile | null> {
  const { data, error } = await supabase
    .from("agent_files")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", fileId)
    .maybeSingle();
  if (error) throw new Error(`[agent-files] get failed: ${error.message}`);
  return (data as AgentFile | null) ?? null;
}

/** Compara nombres sin mayúsculas, acentos ni espacios de más. */
export function normalizeFileName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function findFileByName(files: AgentFile[], name: string): AgentFile | null {
  const wanted = normalizeFileName(name);
  if (!wanted) return null;
  return files.find((f) => normalizeFileName(f.name) === wanted) ?? null;
}

const KIND_LABELS: Record<AgentFileKind, string> = {
  document: "documento",
  audio: "audio",
  video: "vídeo",
  image: "imagen",
};

/**
 * Bloque del prompt con los archivos que el agente puede enviar. Vacío si no
 * hay archivos: sin lista, el agente no tiene nada que pedir.
 */
export function formatAgentFilesContext(files: AgentFile[]): string {
  if (files.length === 0) return "";
  const lines = files.map((f) => {
    const when = f.description.trim() ? ` — ${f.description.trim()}` : "";
    return `- "${f.name}" (${KIND_LABELS[f.kind]})${when}`;
  });
  return [
    "## Archivos que puedes enviar",
    "Puedes enviar estos archivos con la herramienta send_file, usando el nombre exacto entre comillas. " +
      "El archivo llega justo después de tu mensaje: en tu respuesta preséntalo en una frase (por ejemplo, " +
      '"Te paso un audio 👇"). Envía un archivo solo cuando aporte a la conversación, ' +
      "como mucho uno o dos por conversación, y nunca el mismo dos veces.",
    ...lines,
  ].join("\n");
}
