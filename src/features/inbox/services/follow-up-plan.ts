// Seguimientos automáticos: cuando el cliente deja de responder, el agente le
// escribe hasta 3 veces dentro de las 24 horas de la ventana de WhatsApp.
//
// No se envían plantillas fijas: cada seguimiento es un turno del agente (un
// batch sin mensajes con meta.follow_up) que pasa por el mismo circuito que
// una respuesta normal — mismo prompt, mismas herramientas (también la nota
// de voz) y el mismo punto único de envío. El agente escribe el seguimiento
// según sus instrucciones y puede decidir no enviarlo (NO_ENVIAR).
//
// Aquí, la lógica pura (cuándo toca, qué se le dice al agente); el
// programador que crea los batches está en follow-ups.ts.

// ── Configuración ────────────────────────────────────────────────────────────

export interface FollowUpConfig {
  enabled: boolean;
  /** Minutos desde el último mensaje del cliente para cada seguimiento. */
  delaysMinutes: [number, number, number];
  /** Horas locales sin mensajes: desde quietStartHour hasta quietEndHour. */
  quietStartHour: number;
  quietEndHour: number;
  /** Zona horaria del cliente (IANA). */
  timeZone: string;
}

export const DEFAULT_FOLLOW_UPS: FollowUpConfig = {
  enabled: false,
  delaysMinutes: [60, 300, 1350],
  quietStartHour: 22,
  quietEndHour: 9,
  timeZone: "Europe/Madrid",
};

/** WhatsApp cierra la ventana a las 24 h: el último sale antes de esto. */
export const WINDOW_DEADLINE_MS = (23 * 60 + 40) * 60_000;
/** Nunca dos seguimientos más juntos que esto. */
export const MIN_GAP_MS = 90 * 60_000;
/** El último sale como mucho este margen antes de la hora de silencio. */
const FINAL_MARGIN_MS = 20 * 60_000;
export const MAX_FOLLOW_UPS = 3;

/** La palabra con la que el agente indica que no tiene sentido escribir. */
export const NO_SEND_TOKEN = "NO_ENVIAR";

function hourOk(h: unknown, fallback: number): number {
  return typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23 ? h : fallback;
}

function validTimeZone(tz: unknown): string | null {
  if (typeof tz !== "string" || !tz.trim()) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** El ajuste de seguimientos del agente, con valores por defecto. */
export function followUpConfigOf(config: Record<string, unknown> | null | undefined): FollowUpConfig {
  const raw = (config?.followUps ?? {}) as Partial<FollowUpConfig>;
  const delays = Array.isArray(raw.delaysMinutes) ? raw.delaysMinutes : [];
  const d = DEFAULT_FOLLOW_UPS.delaysMinutes.map((def, i) => {
    const v = delays[i];
    return typeof v === "number" && v >= 15 && v <= 1400 ? v : def;
  }) as [number, number, number];
  return {
    enabled: raw.enabled === true,
    delaysMinutes: d,
    quietStartHour: hourOk(raw.quietStartHour, DEFAULT_FOLLOW_UPS.quietStartHour),
    quietEndHour: hourOk(raw.quietEndHour, DEFAULT_FOLLOW_UPS.quietEndHour),
    timeZone: validTimeZone(raw.timeZone) ?? DEFAULT_FOLLOW_UPS.timeZone,
  };
}

// ── Cuándo toca ──────────────────────────────────────────────────────────────

function localHour(ms: number, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
  return Number(h) % 24;
}

export function isQuiet(ms: number, cfg: FollowUpConfig): boolean {
  const h = localHour(ms, cfg.timeZone);
  const { quietStartHour: s, quietEndHour: e } = cfg;
  if (s === e) return false;
  return s > e ? h >= s || h < e : h >= s && h < e;
}

const SCAN_STEP_MS = 10 * 60_000;

/** El último instante permitido (fuera de las horas de silencio) antes de `until`. */
function lastSendableBefore(until: number, cfg: FollowUpConfig): number | null {
  for (let t = until; t > until - 24 * 3_600_000; t -= SCAN_STEP_MS) {
    if (!isQuiet(t, cfg)) return t;
  }
  return null;
}

/** El primer instante permitido desde `from`. */
function firstSendableAfter(from: number, cfg: FollowUpConfig): number | null {
  for (let t = from; t < from + 24 * 3_600_000; t += SCAN_STEP_MS) {
    if (!isQuiet(t, cfg)) return t;
  }
  return null;
}

/** Margen mínimo, por la mañana, entre el fin del silencio y el cierre de la ventana. */
const MORNING_MARGIN_MS = 30 * 60_000;

/**
 * Cuándo sale el último seguimiento: a su hora; si cae de noche, al acabar
 * el silencio si aún queda margen en la ventana, y si no la noche anterior,
 * antes de que empiece el silencio.
 */
export function finalFollowUpAt(lastInboundAt: number, cfg: FollowUpConfig): number {
  const deadline = lastInboundAt + WINDOW_DEADLINE_MS;
  let target = Math.min(lastInboundAt + cfg.delaysMinutes[2] * 60_000, deadline - FINAL_MARGIN_MS);
  if (isQuiet(target, cfg)) {
    const morning = firstSendableAfter(target, cfg);
    if (morning === null || morning > deadline - MORNING_MARGIN_MS) {
      const evening = lastSendableBefore(target, cfg);
      target = (evening ?? target) - FINAL_MARGIN_MS;
    }
  }
  return target;
}

export interface FollowUpState {
  /** Último mensaje del cliente. */
  lastInboundAt: number;
  /** Seguimientos ya enviados desde ese mensaje. */
  sent: number;
  /** Cuándo salió el último seguimiento, si hubo. */
  lastFollowUpAt: number | null;
}

/**
 * El seguimiento que toca ahora (1, 2 o 3), o null.
 * - 1 y 2 a su hora (o en cuanto acaben las horas de silencio);
 * - el 3 (el último) a su hora, o antes si su hora cae de noche o fuera de
 *   la ventana de 24 h: nunca se pierde por dormir;
 * - nunca de noche, nunca con menos de MIN_GAP_MS del anterior.
 */
export function dueFollowUp(state: FollowUpState, now: number, cfg: FollowUpConfig): 1 | 2 | 3 | null {
  if (state.sent >= MAX_FOLLOW_UPS) return null;
  const elapsed = now - state.lastInboundAt;
  const deadline = state.lastInboundAt + WINDOW_DEADLINE_MS;
  if (now >= deadline) return null;
  if (isQuiet(now, cfg)) return null;
  if (state.lastFollowUpAt !== null && now - state.lastFollowUpAt < MIN_GAP_MS) return null;

  const [d1, d2] = cfg.delaysMinutes.map((m) => m * 60_000);
  const finalAt = finalFollowUpAt(state.lastInboundAt, cfg);
  // Nunca el último antes que el primero debería salir.
  if (elapsed >= Math.max(d1, finalAt - state.lastInboundAt)) return 3;

  const next = state.sent + 1;
  if (next === 1 && elapsed >= d1) return 1;
  if (next === 2 && elapsed >= d2) return 2;
  return null;
}

/**
 * Lo que el agente recibe en lugar de un mensaje del cliente. Deja claro que
 * no lo escribió el cliente, qué seguimiento es y cómo no enviarlo.
 */
export function followUpInstruction(step: 1 | 2 | 3, hoursSilent: number): string {
  const h = Math.max(1, Math.round(hoursSilent));
  const which =
    step === 3
      ? "el seguimiento 3 de 3, el último"
      : `el seguimiento ${step} de 3`;
  return (
    `[SEGUIMIENTO AUTOMÁTICO — esto no lo ha escrito el cliente. ` +
    `El cliente no responde desde hace unas ${h} ${h === 1 ? "hora" : "horas"}. ` +
    `Escríbele ahora ${which}, tal como dicen tus instrucciones para cuando la persona deja de responder. ` +
    `Retoma lo último que hablasteis, usa su nombre si lo sabes y no repitas mensajes ni argumentos que ya usaste. ` +
    `Si por la conversación ya agendó, pidió que no le escribas o no tiene sentido escribirle, ` +
    `responde solo con la palabra ${NO_SEND_TOKEN}.]`
  );
}

/**
 * The agent's answer when it realises mid-conversation that the person is not
 * a prospect (someone the owner knows, a supplier, a sales call): nothing is
 * sent and the chat goes to the owner.
 */
export const NOT_A_CLIENT_TOKEN = "[[NO_ES_CLIENTE]]";

export function isNotAClientReply(text: string): boolean {
  return text.includes(NOT_A_CLIENT_TOKEN);
}

/** The reply without the token, in case it shows up next to real text. */
export function stripNotAClientToken(text: string): string {
  return text.split(NOT_A_CLIENT_TOKEN).join("").trim();
}

export function isNoSendReply(text: string): boolean {
  return text.includes(NO_SEND_TOKEN);
}

export interface FollowUpMeta {
  step: 1 | 2 | 3;
  /** El último mensaje del cliente en que se basa: si llega otro, no sale. */
  after: string;
}

export function followUpOf(meta: Record<string, unknown> | null | undefined): FollowUpMeta | null {
  const f = meta?.follow_up as Partial<FollowUpMeta> | undefined;
  if (!f || (f.step !== 1 && f.step !== 2 && f.step !== 3) || typeof f.after !== "string") return null;
  return { step: f.step, after: f.after };
}

