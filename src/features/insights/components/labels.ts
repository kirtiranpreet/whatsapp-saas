export const OBJECTION_LABEL: Record<string, string> = {
  precio: "Precio",
  tiempo: "Tiempo",
  confianza: "Confianza",
  miedo: "Miedo",
  pensarlo: "Necesita pensarlo",
  consultarlo: "Necesita consultarlo",
  momento: "Momento",
  experiencias_previas: "Experiencias anteriores",
  falta_claridad: "Falta de claridad",
  comparacion: "Comparación",
  otra: "Otra",
};

export const KIND_LABEL: Record<string, string> = {
  objecion_explicita: "Objeción explícita",
  preocupacion: "Preocupación",
  duda: "Duda",
  obstaculo: "Obstáculo",
  inferencia: "Inferencia de la IA",
};

export const NON_BUYING_LABEL: Record<string, string> = {
  precio: "Precio",
  momento: "Momento",
  falta_confianza: "Falta de confianza",
  pensarlo: "Necesita pensarlo",
  consultarlo: "Necesita consultarlo",
  no_entiende_oferta: "No entiende la oferta",
  miedo: "Miedo",
  comparacion: "Comparación",
  otro: "Otro",
};

export const OUTCOME_LABEL: Record<string, string> = {
  compro: "Compró",
  agendo_llamada: "Agendó llamada",
  rechazo: "Rechazó",
  no_compro: "No compró",
  pendiente: "Pendiente",
  indeterminado: "Indeterminado",
};

export const INTENT_LABEL: Record<string, string> = {
  alta: "🔥 Alta",
  media: "🟡 Media",
  baja: "❄️ Baja",
};

export const SENTIMENT_LABEL: Record<string, string> = {
  positivo: "Positivo",
  neutro: "Neutro",
  negativo: "Negativo",
  mixto: "Mixto",
};

export const FUNNEL_LABEL: Record<string, string> = {
  inicio: "Inicio",
  interes: "Interés",
  necesidad: "Necesidad",
  pregunta: "Pregunta",
  objecion: "Objeción",
  respuesta: "Respuesta",
  decision: "Decisión",
};

export const MOMENT_LABEL: Record<string, string> = {
  necesidad: "Necesidad",
  pregunta: "Pregunta",
  objecion: "Objeción",
  cambio_de_opinion: "Cambio de opinión",
  decision: "Decisión",
  compra: "Compra",
  abandono: "Abandono",
  cierre: "Cierre",
};

export const FOLLOWUP_LABEL: Record<string, string> = {
  sin_responder: "⚪ Sin responder",
  activa: "🟢 Activa",
  seguimiento_pendiente: "🟡 Seguimiento pendiente",
  enfriandose: "🟠 Enfriándose",
  alto_riesgo: "🔴 Alto riesgo",
  cerrada: "✔︎ Cerrada",
};

export const RECOMMENDATION_LABEL: Record<string, string> = {
  crear_faq: "Crear FAQ",
  modificar_respuesta: "Modificar respuesta",
  aclarar_oferta: "Aclarar la oferta",
  mejorar_cta: "Mejorar el CTA",
  crear_contenido: "Crear contenido",
  seccion_landing: "Sección de landing",
  responder_objecion: "Responder objeción",
};

export function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

export function formatDate(iso: string, tz?: string): string {
  try {
    return new Intl.DateTimeFormat("es-ES", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

export function formatDay(iso: string, tz?: string): string {
  try {
    return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function hoursAgo(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return "menos de 1 h";
  if (h < 48) return `${Math.floor(h)} h`;
  return `${Math.floor(h / 24)} días`;
}
