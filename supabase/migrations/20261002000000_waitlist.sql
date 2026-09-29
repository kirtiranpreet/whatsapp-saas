-- ============================================================
-- Migration: 20261002000000_waitlist
-- Lista de espera por ciudad
--
-- Cuando a un cliente no le encaja ninguna edición, el agente le apunta
-- (tool join_waitlist) para avisarle cuando haya una nueva en su ciudad. Se
-- ve y se descarga (CSV) en Configuración → Lista de espera. Si HighLevel
-- está conectado, el contacto recibe además las etiquetas "lista-espera" y
-- "lista-espera-<ciudad>" para que un workflow de GHL les avise.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.waitlist_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  city TEXT NOT NULL CHECK (char_length(city) BETWEEN 1 AND 80),
  name TEXT CHECK (name IS NULL OR char_length(name) <= 120),
  phone TEXT,
  email TEXT CHECK (email IS NULL OR char_length(email) <= 200),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified')),
  hl_tagged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_waitlist_workspace
  ON public.waitlist_entries(workspace_id, created_at DESC);

-- Una vez por contacto y ciudad: apuntarse otra vez solo actualiza la fila.
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_contact_city
  ON public.waitlist_entries(workspace_id, contact_id, lower(city));

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "waitlist_select" ON public.waitlist_entries;
CREATE POLICY "waitlist_select"
  ON public.waitlist_entries FOR SELECT
  USING (workspace_id IN (SELECT public.auth_workspace_ids()));

DROP POLICY IF EXISTS "waitlist_write" ON public.waitlist_entries;
CREATE POLICY "waitlist_write"
  ON public.waitlist_entries FOR ALL
  USING (
    workspace_id IN (SELECT public.auth_workspace_ids())
    AND public.auth_has_role(workspace_id, ARRAY['admin','manager']::public.workspace_role[])
  )
  WITH CHECK (
    workspace_id IN (SELECT public.auth_workspace_ids())
    AND public.auth_has_role(workspace_id, ARRAY['admin','manager']::public.workspace_role[])
  );

-- Tool en el catálogo, deshabilitada por defecto (Configuración → Tools).
INSERT INTO public.tools (key, name, description, schema, sensitivity) VALUES
  ('join_waitlist', 'Lista de espera',
   'Apunta al cliente en la lista de espera de una ciudad para avisarle cuando haya una nueva edición',
   '{"type":"object","properties":{"city":{"type":"string"},"name":{"type":"string"},"email":{"type":"string"},"notes":{"type":"string"}},"required":["city"]}',
   'read')
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      schema = EXCLUDED.schema,
      sensitivity = EXCLUDED.sensitivity;

-- ============================================================
-- End of migration: 20261002000000_waitlist
-- ============================================================
