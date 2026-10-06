-- ============================================================
-- Migration: 20261006000000_conversation_insights
-- Inteligencia de conversaciones + informe semanal
--
-- Analiza SOLO las conversaciones en las que respondió el agente de IA del
-- workspace (mensajes salientes sin operador humano, con batch del agente).
-- Cada informe (semanal automático o manual) tiene:
--   · insight_reports         → el informe: periodo, estado, agregados, recomendaciones
--   · conversation_insights   → la extracción de cada conversación (JSON validado,
--                               cada dato con referencia al mensaje original)
--   · insight_content         → contenido generado desde una pregunta/objeción
--
-- Los agregados (frecuencias, porcentajes) se calculan en código a partir de
-- las extracciones, nunca los inventa el modelo. Borrar un informe borra en
-- cascada todo lo que cuelga de él. Borrar una conversación borra su análisis.
--
-- Escrituras: solo el servidor (service role) tras comprobar el rol en la ruta.
-- Lectura: miembros activos del workspace (RLS).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.insight_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('weekly', 'manual')),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL CHECK (period_end > period_start),
  time_zone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'finalizing', 'ready', 'failed')),
  conversation_count INT NOT NULL DEFAULT 0,
  analyzed_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  model TEXT,
  error TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  finalizing_since TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_insight_reports_workspace
  ON public.insight_reports(workspace_id, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_insight_reports_status
  ON public.insight_reports(status) WHERE status IN ('processing', 'finalizing');

-- Un único informe semanal por workspace y semana.
CREATE UNIQUE INDEX IF NOT EXISTS uq_insight_reports_weekly
  ON public.insight_reports(workspace_id, period_start) WHERE kind = 'weekly';

DROP TRIGGER IF EXISTS trg_insight_reports_updated_at ON public.insight_reports;
CREATE TRIGGER trg_insight_reports_updated_at
  BEFORE UPDATE ON public.insight_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.conversation_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES public.insight_reports(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  message_count INT NOT NULL DEFAULT 0,
  extraction JSONB,
  -- Elementos que el modelo devolvió pero no superaron la verificación
  -- (cita no literal, referencia a un mensaje inexistente…): se descartan y
  -- se cuentan aquí para poder auditar.
  dropped JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (report_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_insights_report
  ON public.conversation_insights(report_id, status);
CREATE INDEX IF NOT EXISTS idx_conversation_insights_conversation
  ON public.conversation_insights(conversation_id);

DROP TRIGGER IF EXISTS trg_conversation_insights_updated_at ON public.conversation_insights;
CREATE TRIGGER trg_conversation_insights_updated_at
  BEFORE UPDATE ON public.conversation_insights
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.insight_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES public.insight_reports(id) ON DELETE CASCADE,
  source JSONB NOT NULL,
  content JSONB NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_insight_content_report
  ON public.insight_content(report_id, created_at DESC);

-- ---- RLS: lectura para miembros; sin políticas de escritura (solo service role) ----
ALTER TABLE public.insight_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insight_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insight_reports_select" ON public.insight_reports;
CREATE POLICY "insight_reports_select"
  ON public.insight_reports FOR SELECT
  USING (workspace_id IN (SELECT public.auth_workspace_ids()));

DROP POLICY IF EXISTS "conversation_insights_select" ON public.conversation_insights;
CREATE POLICY "conversation_insights_select"
  ON public.conversation_insights FOR SELECT
  USING (workspace_id IN (SELECT public.auth_workspace_ids()));

DROP POLICY IF EXISTS "insight_content_select" ON public.insight_content;
CREATE POLICY "insight_content_select"
  ON public.insight_content FOR SELECT
  USING (workspace_id IN (SELECT public.auth_workspace_ids()));

-- ============================================================
-- End of migration: 20261006000000_conversation_insights
-- ============================================================
