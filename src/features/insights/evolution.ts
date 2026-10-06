// Evolución respecto al informe anterior: cuánto cambió el porcentaje de
// conversaciones en que aparece cada objeción, pregunta o motivo de no compra.
// Se expresa en puntos porcentuales (pp) para no inflar cambios pequeños.

import type { ReportStats } from "./aggregate";

export interface EvolutionRow {
  key: string;
  name: string;
  current: number;
  previous: number;
  delta_pp: number;
  trend: "sube" | "baja" | "estable" | "nuevo";
}

export interface Evolution {
  previous_report_id: string;
  previous_analyzed: number;
  objections: EvolutionRow[];
  faq: EvolutionRow[];
  non_buying: EvolutionRow[];
}

/** Por debajo de este cambio (en puntos) se considera estable. */
const STABLE_PP = 5;

function compareRows(
  current: Array<{ key: string; name: string; percent: number }>,
  previous: Array<{ key: string; name: string; percent: number }>,
): EvolutionRow[] {
  const prev = new Map(previous.map((r) => [r.key, r]));
  const keys = new Set([...current.map((r) => r.key), ...previous.map((r) => r.key)]);
  const rows: EvolutionRow[] = [];
  for (const key of keys) {
    const c = current.find((r) => r.key === key);
    const p = prev.get(key);
    const cur = c?.percent ?? 0;
    const pre = p?.percent ?? 0;
    const delta = Math.round((cur - pre) * 10) / 10;
    const trend: EvolutionRow["trend"] = !p
      ? "nuevo"
      : Math.abs(delta) < STABLE_PP
        ? "estable"
        : delta > 0
          ? "sube"
          : "baja";
    rows.push({ key, name: c?.name ?? p?.name ?? key, current: cur, previous: pre, delta_pp: delta, trend });
  }
  return rows.sort((a, b) => Math.abs(b.delta_pp) - Math.abs(a.delta_pp) || a.name.localeCompare(b.name));
}

export function compareStats(
  current: ReportStats,
  previous: ReportStats,
  previousReportId: string,
): Evolution {
  return {
    previous_report_id: previousReportId,
    previous_analyzed: previous.totals?.analyzed ?? 0,
    objections: compareRows(current.objections, previous.objections ?? []),
    faq: compareRows(current.faq, previous.faq ?? []).slice(0, 15),
    non_buying: compareRows(current.non_buying, previous.non_buying ?? []),
  };
}
