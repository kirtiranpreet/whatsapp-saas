// Categorías cerradas del análisis (sin dependencias, para poder usarlas en tests y en el cliente).

export const OBJECTION_CATEGORIES = [
  "precio",
  "tiempo",
  "confianza",
  "miedo",
  "pensarlo",
  "consultarlo",
  "momento",
  "experiencias_previas",
  "falta_claridad",
  "comparacion",
  "otra",
] as const;

export const OBJECTION_KINDS = [
  "objecion_explicita",
  "preocupacion",
  "duda",
  "obstaculo",
  "inferencia",
] as const;

export const NON_BUYING_CATEGORIES = [
  "precio",
  "momento",
  "falta_confianza",
  "pensarlo",
  "consultarlo",
  "no_entiende_oferta",
  "miedo",
  "comparacion",
  "otro",
] as const;

export const OUTCOMES = [
  "compro",
  "agendo_llamada",
  "rechazo",
  "no_compro",
  "pendiente",
  "indeterminado",
] as const;

export const INTENT_LEVELS = ["alta", "media", "baja"] as const;
export const SENTIMENTS = ["positivo", "neutro", "negativo", "mixto"] as const;

export const MOMENT_TYPES = [
  "necesidad",
  "pregunta",
  "objecion",
  "cambio_de_opinion",
  "decision",
  "compra",
  "abandono",
  "cierre",
] as const;

export const FUNNEL_STAGES = [
  "inicio",
  "interes",
  "necesidad",
  "pregunta",
  "objecion",
  "respuesta",
  "decision",
] as const;

export const RECOMMENDATION_TYPES = [
  "crear_faq",
  "modificar_respuesta",
  "aclarar_oferta",
  "mejorar_cta",
  "crear_contenido",
  "seccion_landing",
  "responder_objecion",
] as const;
