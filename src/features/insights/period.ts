// Semanas del informe: de lunes 00:00 a lunes 00:00 en la zona horaria del
// negocio. El informe de una semana se genera a partir del lunes siguiente a
// las 08:00 (hora local), cuando la semana ya está cerrada.

import { wallClockOf, wallClockToInstant } from "@/shared/lib/timezone";

const DAY_MS = 24 * 3600_000;
export const WEEKLY_READY_HOUR = 8;

function localMidnight(year: number, month: number, day: number, tz: string): number {
  // Medianoche puede no existir en zonas con cambio de hora a las 00:00:
  // entonces se toma la primera hora válida del día.
  for (let hour = 0; hour < 3; hour++) {
    const t = wallClockToInstant({ year, month, day, hour, minute: 0, second: 0 }, tz);
    if (t !== null) return t;
  }
  return Date.UTC(year, month - 1, day);
}

function dateParts(utcMs: number): { year: number; month: number; day: number } {
  const d = new Date(utcMs);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Lunes 00:00 local de la semana que contiene `nowMs`. */
export function weekStartOf(nowMs: number, tz: string): number {
  const w = wallClockOf(nowMs, tz);
  const asDate = Date.UTC(w.year, w.month - 1, w.day);
  const dow = new Date(asDate).getUTCDay(); // 0 domingo
  const sinceMonday = (dow + 6) % 7;
  const monday = dateParts(asDate - sinceMonday * DAY_MS);
  return localMidnight(monday.year, monday.month, monday.day, tz);
}

/** La última semana completa (lunes a lunes) antes de `nowMs`. */
export function lastFullWeek(nowMs: number, tz: string): { start: number; end: number } {
  const end = weekStartOf(nowMs, tz);
  const w = wallClockOf(end, tz);
  const prev = dateParts(Date.UTC(w.year, w.month - 1, w.day) - 7 * DAY_MS);
  return { start: localMidnight(prev.year, prev.month, prev.day, tz), end };
}

/** True cuando ya toca generar el informe de la última semana completa. */
export function weeklyReportDue(nowMs: number, tz: string): boolean {
  const { end } = lastFullWeek(nowMs, tz);
  return wallClockOf(nowMs, tz).hour >= WEEKLY_READY_HOUR || nowMs - end >= DAY_MS;
}

/** La semana anterior a un periodo (para comparar la evolución). */
export function previousPeriod(start: number, end: number): { start: number; end: number } {
  const length = end - start;
  return { start: start - length, end: start };
}
