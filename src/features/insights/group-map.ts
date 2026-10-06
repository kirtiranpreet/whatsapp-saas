// Validación pura de una agrupación de etiquetas (sin llamadas al modelo).

import type { LabelMap } from "./aggregate";

const key = (s: string) => s.trim().toLocaleLowerCase("es");

/** Valida una agrupación: devuelve el mapa o null si no cubre todas las etiquetas. */
export function toLabelMap(
  labels: string[],
  groups: { name: string; members: string[] }[],
): LabelMap | null {
  const wanted = new Set(labels.map(key));
  const map: LabelMap = new Map();
  for (const g of groups) {
    for (const m of g.members) {
      const k = key(m);
      if (!wanted.has(k) || map.has(k)) return null;
      map.set(k, g.name.trim());
    }
  }
  return map.size === wanted.size ? map : null;
}
