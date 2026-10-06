-- ============================================================
-- Post-deploy cron: inteligencia de conversaciones cada 5 minutos
--
-- Crea el informe semanal cuando toca (lunes a partir de las 08:00 en la zona
-- del negocio) y avanza el análisis de los informes en curso por tandas.
-- Mismo mecanismo que schedule-buffer-flush.sql.
--
-- HOW to run: reemplaza los dos marcadores y ejecútalo en Supabase → SQL Editor.
-- Es idempotente.
--   __APP_URL__      -> NEXT_PUBLIC_APP_URL  (sin barra final)
--   __CRON_SECRET__  -> CRON_SECRET
-- ============================================================

select cron.schedule(
  'insights-tick',
  '*/5 * * * *',
  $job$
    select net.http_get(
      url     := '__APP_URL__/api/cron/insights',
      headers := jsonb_build_object('Authorization', 'Bearer __CRON_SECRET__'),
      timeout_milliseconds := 300000
    );
  $job$
);

-- Comprobar:  select jobname, schedule, active from cron.job where jobname = 'insights-tick';
-- Quitar:     select cron.unschedule('insights-tick');
