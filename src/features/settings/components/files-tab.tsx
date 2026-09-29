"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  Paperclip,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";
import {
  AGENT_FILES_BUCKET,
  checkAgentFile,
  type AgentFile,
  type AgentFileKind,
} from "@/features/agent-files/service";

// ── Helpers ───────────────────────────────────────────────────────────────────

const KIND_LABELS: Record<AgentFileKind, string> = {
  document: "Documento",
  audio: "Audio",
  video: "Vídeo",
  image: "Imagen",
};

const KIND_ICONS: Record<AgentFileKind, typeof FileText> = {
  document: FileText,
  audio: Music,
  video: Film,
  image: ImageIcon,
};

const ACCEPT =
  ".pdf,.doc,.docx,.mp3,.m4a,.aac,.ogg,.mp4,.3gp,.jpg,.jpeg,.png,application/pdf,audio/*,video/mp4,image/jpeg,image/png";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Nombre legible a partir del nombre del archivo: "audio-bienvenida.mp3" → "Audio bienvenida". */
function suggestName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "";
}

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  try {
    return (await res.json()) as T & { error?: string };
  } catch {
    return {} as T & { error?: string };
  }
}

// ── File row ──────────────────────────────────────────────────────────────────

function FileRow({
  file,
  canManage,
  onDelete,
  onSave,
}: {
  file: AgentFile;
  canManage: boolean;
  onDelete: (file: AgentFile) => Promise<void>;
  onSave: (file: AgentFile, patch: { name: string; description: string }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(file.name);
  const [description, setDescription] = useState(file.description);
  const Icon = KIND_ICONS[file.kind] ?? Paperclip;

  async function save() {
    setBusy(true);
    const ok = await onSave(file, { name: name.trim(), description: description.trim() });
    setBusy(false);
    if (ok) setEditing(false);
  }

  async function remove() {
    setBusy(true);
    await onDelete(file);
    setBusy(false);
  }

  return (
    <li className="rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor={`file-name-${file.id}`}>Nombre</Label>
                <Input
                  id={`file-name-${file.id}`}
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`file-desc-${file.id}`}>Cuándo enviarlo</Label>
                <Textarea
                  id={`file-desc-${file.id}`}
                  value={description}
                  maxLength={1000}
                  rows={3}
                  className="resize-none"
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={busy || !name.trim()}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                  Guardar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setName(file.name);
                    setDescription(file.description);
                    setEditing(false);
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{file.name}</span>
                <Badge variant="outline" className="text-xs font-normal">
                  {KIND_LABELS[file.kind]}
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {file.filename} · {formatSize(file.size_bytes)}
              </p>
              {file.description ? (
                <p className="mt-2 text-xs leading-relaxed text-foreground/80">
                  {file.description}
                </p>
              ) : (
                <p className="mt-2 text-xs italic text-muted-foreground">
                  Sin indicaciones: añade cuándo debe enviarlo el agente.
                </p>
              )}
            </>
          )}
        </div>

        {canManage && !editing && (
          <div className="flex shrink-0 items-center gap-1">
            {confirming ? (
              <>
                <Button size="sm" variant="destructive" onClick={remove} disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                  Borrar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                  No
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Editar ${file.name}`}
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Borrar ${file.name}`}
                  className="hover:text-destructive"
                  onClick={() => setConfirming(true)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
  canManage: boolean;
}

export function FilesTab({ workspaceId, canManage }: Props) {
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [picked, setPicked] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/files`);
      const json = await readJson<{ data?: AgentFile[] }>(res);
      if (!res.ok) throw new Error(json.error ?? "No se pudieron cargar los archivos");
      setFiles(json.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: load resets loading/error before each (re)fetch
    load();
  }, [load]);

  function handlePick(file: File | null) {
    if (!file) return;
    const check = checkAgentFile(file.type || "", file.size);
    if (!check.ok) {
      toast.error(check.error);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setPicked(file);
    if (!name.trim()) setName(suggestName(file.name));
  }

  function resetForm() {
    setPicked(null);
    setName("");
    setDescription("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleUpload() {
    if (!picked) {
      toast.error("Elige un archivo");
      return;
    }
    if (!name.trim()) {
      toast.error("Ponle un nombre al archivo");
      return;
    }
    setIsUploading(true);
    try {
      // 1. Signed upload URL (validates type and size on the server too)
      const urlRes = await fetch(`/api/workspace/${workspaceId}/files/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: picked.name,
          mimeType: picked.type,
          sizeBytes: picked.size,
        }),
      });
      const urlJson = await readJson<{
        data?: { fileId: string; path: string; token: string; mimeType: string };
      }>(urlRes);
      if (!urlRes.ok || !urlJson.data) {
        throw new Error(urlJson.error ?? "No se pudo preparar la subida");
      }
      const { fileId, path, token, mimeType } = urlJson.data;

      // 2. Straight to storage: Vercel would refuse a body this size
      const { error: uploadError } = await createClient()
        .storage.from(AGENT_FILES_BUCKET)
        .uploadToSignedUrl(path, token, picked, { contentType: mimeType });
      if (uploadError) throw new Error("No se pudo subir el archivo. Vuelve a intentarlo.");

      // 3. Register it in the library
      const res = await fetch(`/api/workspace/${workspaceId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          name: name.trim(),
          description: description.trim(),
          filename: picked.name,
          mimeType,
          sizeBytes: picked.size,
        }),
      });
      const json = await readJson<{ data?: AgentFile }>(res);
      if (!res.ok || !json.data) throw new Error(json.error ?? "No se pudo guardar el archivo");

      setFiles((prev) => [...prev, json.data as AgentFile]);
      toast.success("Archivo añadido");
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo subir el archivo");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSave(
    file: AgentFile,
    patch: { name: string; description: string },
  ): Promise<boolean> {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/files/${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await readJson<{ data?: AgentFile }>(res);
      if (!res.ok || !json.data) throw new Error(json.error ?? "No se pudo guardar");
      setFiles((prev) => prev.map((f) => (f.id === file.id ? (json.data as AgentFile) : f)));
      toast.success("Guardado");
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
      return false;
    }
  }

  async function handleDelete(file: AgentFile) {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/files/${file.id}`, {
        method: "DELETE",
      });
      const json = await readJson<{ ok?: boolean }>(res);
      if (!res.ok) throw new Error(json.error ?? "No se pudo borrar");
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      toast.success("Archivo borrado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo borrar");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" aria-hidden />
        <div>
          <p className="text-sm font-medium text-foreground">No pudimos cargar los archivos</p>
          <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="font-display text-sm font-medium text-foreground">Archivos del agente</h3>
        <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
          PDF, audios, vídeos e imágenes que el agente puede enviar por WhatsApp. Para que los
          envíe, activa la herramienta «Enviar archivo» en la pestaña Tools. El agente elige el
          archivo por su nombre y sigue las indicaciones de «Cuándo enviarlo».
        </p>
      </div>

      {canManage && (
        <div className="space-y-4 rounded-lg border border-border/60 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="agent-file-input">Archivo</Label>
            <input
              ref={inputRef}
              id="agent-file-input"
              type="file"
              accept={ACCEPT}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
              onChange={(e) => handlePick(e.target.files?.[0] ?? null)}
              disabled={isUploading}
            />
            <p className="text-xs text-muted-foreground">
              PDF o Word hasta 50 MB · audio MP3, M4A u OGG hasta 16 MB · vídeo MP4 hasta 16 MB ·
              imagen JPG o PNG hasta 5 MB
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-file-name">Nombre</Label>
            <Input
              id="agent-file-name"
              value={name}
              maxLength={120}
              placeholder="Audio de bienvenida"
              onChange={(e) => setName(e.target.value)}
              disabled={isUploading}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-file-desc">Cuándo enviarlo</Label>
            <Textarea
              id="agent-file-desc"
              value={description}
              maxLength={1000}
              rows={3}
              className="resize-none"
              placeholder="Envíalo cuando la persona pregunte cómo es la formación, antes de invitarla a la llamada."
              onChange={(e) => setDescription(e.target.value)}
              disabled={isUploading}
            />
          </div>

          <Button size="sm" onClick={handleUpload} disabled={isUploading || !picked}>
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Subiendo…
              </>
            ) : (
              <>
                <Upload className="mr-1.5 h-4 w-4" aria-hidden />
                Subir archivo
              </>
            )}
          </Button>
        </div>
      )}

      <Separator />

      {files.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/60 py-12 text-center">
          <Paperclip className="h-9 w-9 text-muted-foreground/50" aria-hidden />
          <div>
            <p className="text-sm font-medium text-foreground">Sin archivos</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Sube el primero arriba: un audio de presentación, un PDF con el programa o un vídeo.
            </p>
          </div>
        </div>
      ) : (
        <ul className="space-y-2" role="list">
          {files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              canManage={canManage}
              onDelete={handleDelete}
              onSave={handleSave}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
