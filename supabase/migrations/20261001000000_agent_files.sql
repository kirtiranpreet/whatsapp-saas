-- ============================================================
-- Migration: 20261001000000_agent_files
-- Biblioteca de archivos del agente (PDF, audios, vídeos, imágenes)
--
-- Cada workspace sube archivos con un nombre y una descripción de cuándo
-- enviarlos. La tool send_file los manda por WhatsApp después de la
-- respuesta del agente (buffer.ts).
--
-- Los archivos viven en el bucket privado whatsapp-media, con la ruta
-- {workspace_id}/{file_id}/{nombre}: la misma forma que usa media-handler,
-- así /api/inbox/media-url y la política de lectura por workspace ya
-- funcionan para ellos sin cambios.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  kind TEXT NOT NULL CHECK (kind IN ('document', 'audio', 'video', 'image')),
  mime_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  storage_path TEXT NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_files_workspace
  ON public.agent_files(workspace_id, created_at DESC);

-- Un nombre por workspace: es lo que el agente usa para pedir el archivo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_files_workspace_name
  ON public.agent_files(workspace_id, lower(name));

ALTER TABLE public.agent_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_files_select" ON public.agent_files;
CREATE POLICY "agent_files_select"
  ON public.agent_files FOR SELECT
  USING (workspace_id IN (SELECT public.auth_workspace_ids()));

DROP POLICY IF EXISTS "agent_files_write" ON public.agent_files;
CREATE POLICY "agent_files_write"
  ON public.agent_files FOR ALL
  USING (
    workspace_id IN (SELECT public.auth_workspace_ids())
    AND public.auth_has_role(workspace_id, ARRAY['admin','manager']::public.workspace_role[])
  )
  WITH CHECK (
    workspace_id IN (SELECT public.auth_workspace_ids())
    AND public.auth_has_role(workspace_id, ARRAY['admin','manager']::public.workspace_role[])
  );

-- Tool en el catálogo. Deshabilitada por defecto (sin fila en tool_configs):
-- se activa por workspace desde Configuración → Tools.
INSERT INTO public.tools (key, name, description, schema, sensitivity) VALUES
  ('send_file', 'Enviar archivo',
   'Envía por WhatsApp un PDF, audio, vídeo o imagen de la biblioteca de Archivos del workspace',
   '{"type":"object","properties":{"file_name":{"type":"string"}},"required":["file_name"]}',
   'read')
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      schema = EXCLUDED.schema,
      sensitivity = EXCLUDED.sensitivity;

-- ============================================================
-- End of migration: 20261001000000_agent_files
-- ============================================================
