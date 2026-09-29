import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentFileStoragePath,
  checkAgentFile,
  findFileByName,
  formatAgentFilesContext,
  safeStorageName,
  type AgentFile,
} from "./service.ts";
import { mediaPayload } from "../inbox/services/kapso-client.ts";

const file = (over: Partial<AgentFile>): AgentFile => ({
  id: "f1",
  workspace_id: "w1",
  name: "Audio de bienvenida",
  description: "",
  kind: "audio",
  mime_type: "audio/mpeg",
  filename: "bienvenida.mp3",
  size_bytes: 1000,
  storage_path: "w1/f1/bienvenida.mp3",
  created_at: "2026-09-29T00:00:00Z",
  ...over,
});

test("checkAgentFile accepts WhatsApp types and maps their kind", () => {
  assert.deepEqual(checkAgentFile("application/pdf", 1000), {
    ok: true,
    kind: "document",
    mime: "application/pdf",
  });
  assert.deepEqual(checkAgentFile("audio/x-m4a", 1000), {
    ok: true,
    kind: "audio",
    mime: "audio/mp4",
  });
  const video = checkAgentFile("video/mp4", 1000);
  assert.equal(video.ok && video.kind, "video");
});

test("checkAgentFile refuses unknown types, empty files and WhatsApp's size limits", () => {
  assert.equal(checkAgentFile("application/zip", 1000).ok, false);
  assert.equal(checkAgentFile("audio/mpeg", 0).ok, false);
  assert.equal(checkAgentFile("video/mp4", 17 * 1024 * 1024).ok, false);
  assert.equal(checkAgentFile("image/png", 6 * 1024 * 1024).ok, false);
  assert.equal(checkAgentFile("application/pdf", 40 * 1024 * 1024).ok, true);
});

test("storage paths match the {workspace}/{id}/{name} shape media-url accepts", () => {
  assert.equal(safeStorageName("Programa Formación (2026).pdf"), "Programa_Formacion_2026_.pdf");
  const path = agentFileStoragePath(
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "Audio Antonio.mp3",
  );
  assert.match(path, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/);
});

test("findFileByName ignores case, accents and extra spaces", () => {
  const files = [file({}), file({ id: "f2", name: "Programa de la formación" })];
  assert.equal(findFileByName(files, "  audio DE bienvenida ")?.id, "f1");
  assert.equal(findFileByName(files, "programa de la formacion")?.id, "f2");
  assert.equal(findFileByName(files, "otro"), null);
  assert.equal(findFileByName(files, ""), null);
});

test("formatAgentFilesContext lists files with their instructions, or nothing", () => {
  assert.equal(formatAgentFilesContext([]), "");
  const text = formatAgentFilesContext([
    file({ description: "Envíalo al presentar la formación." }),
  ]);
  assert.match(text, /## Archivos que puedes enviar/);
  assert.match(text, /- "Audio de bienvenida" \(audio\) — Envíalo al presentar la formación\./);
});

test("mediaPayload puts filename on documents and never a caption on audio", () => {
  assert.deepEqual(
    mediaPayload({ kind: "document", link: "https://x/a.pdf", filename: "a.pdf", caption: "Hola" }),
    { link: "https://x/a.pdf", filename: "a.pdf", caption: "Hola" },
  );
  assert.deepEqual(
    mediaPayload({ kind: "audio", link: "https://x/a.mp3", filename: "a.mp3", caption: "Hola" }),
    { link: "https://x/a.mp3" },
  );
});
