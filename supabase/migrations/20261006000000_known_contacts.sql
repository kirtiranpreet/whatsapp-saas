-- ============================================================
-- Migration: 20261006000000_known_contacts
-- Contactos antiguos: el agente solo atiende contactos NUEVOS
--
-- En coexistencia el número es el WhatsApp personal del dueño. Quien ya
-- hablaba con él (alumnos, conocidos) lo sigue atendiendo él: si uno de estos
-- números abre una conversación nueva, entra directamente en "human_active" y
-- el agente no le contesta.
--
-- La lista se llena de dos formas:
--   · source 'import'  — números pegados o un archivo (.vcf/.csv) subido en
--                         Configuración → Contactos antiguos.
--   · source 'history' — chats antiguos que Kapso reenvía con
--                         kapso.origin = 'history_sync'.
--
-- phone_key es phoneKey() de src/features/inbox/services/phone.ts: la forma
-- de comparar números sin importar cómo los escribió cada sistema.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.known_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  phone_key TEXT NOT NULL CHECK (phone_key ~ '^[0-9]{6,15}$'),
  phone TEXT NOT NULL CHECK (char_length(phone) <= 20),
  name TEXT CHECK (name IS NULL OR char_length(name) <= 120),
  source TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'history')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_known_contacts_phone
  ON public.known_contacts(workspace_id, phone_key);

ALTER TABLE public.known_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "known_contacts_select" ON public.known_contacts;
CREATE POLICY "known_contacts_select"
  ON public.known_contacts FOR SELECT
  USING (workspace_id IN (SELECT public.auth_workspace_ids()));

DROP POLICY IF EXISTS "known_contacts_write" ON public.known_contacts;
CREATE POLICY "known_contacts_write"
  ON public.known_contacts FOR ALL
  USING (
    workspace_id IN (SELECT public.auth_workspace_ids())
    AND public.auth_has_role(workspace_id, ARRAY['admin','manager']::public.workspace_role[])
  )
  WITH CHECK (
    workspace_id IN (SELECT public.auth_workspace_ids())
    AND public.auth_has_role(workspace_id, ARRAY['admin','manager']::public.workspace_role[])
  );

-- ============================================================
-- End of migration: 20261006000000_known_contacts
-- ============================================================
