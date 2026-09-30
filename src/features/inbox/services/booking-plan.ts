// Reservas avisadas desde fuera (un workflow de HighLevel → /api/webhooks/booking).
// Lógica pura: qué trae el aviso y qué se le dice al agente. Sin imports para
// correr bajo `node --test`.

export interface BookingNotice {
  phone: string;
  name: string | null;
  email: string | null;
  /** Cuándo es la cita, tal como llega (ISO o texto de GHL). */
  start: string | null;
  timeZone: string | null;
  calendar: string | null;
  appointmentId: string | null;
}

function str(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function pick(obj: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = str(obj[k]);
    if (v) return v;
  }
  return null;
}

/**
 * Lee el aviso de HighLevel. Acepta el payload estándar de la acción
 * "Webhook" de un workflow (contacto en la raíz, cita en `calendar`) y
 * variantes con los campos en `contact`, `appointment` o `customData`.
 * null si no trae teléfono.
 */
export function parseBookingNotice(body: unknown): BookingNotice | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const contact = (b.contact ?? {}) as Record<string, unknown>;
  const cal = (b.calendar ?? b.appointment ?? {}) as Record<string, unknown>;
  const custom = (b.customData ?? b.custom_data ?? {}) as Record<string, unknown>;

  const phone = pick(b, "phone", "contact_phone") ?? pick(contact, "phone") ?? pick(custom, "phone");
  if (!phone || phone.replace(/\D/g, "").length < 7) return null;

  const first = pick(b, "first_name", "firstName") ?? pick(contact, "first_name", "firstName");
  const full =
    pick(b, "full_name", "fullName", "name", "contact_name") ??
    pick(contact, "full_name", "fullName", "name") ??
    first;

  return {
    phone,
    name: full,
    email: pick(b, "email") ?? pick(contact, "email") ?? pick(custom, "email"),
    start:
      pick(cal, "startTime", "start_time", "appointmentStartTime", "start") ??
      pick(custom, "startTime", "start_time", "appointment_start", "fecha") ??
      pick(b, "appointment_start_time", "startTime"),
    timeZone:
      pick(cal, "selectedTimezone", "timezone", "timeZone") ?? pick(custom, "timezone", "timeZone"),
    calendar: pick(cal, "calendarName", "calendar_name", "title") ?? pick(custom, "calendar"),
    appointmentId:
      pick(cal, "appointmentId", "appointment_id", "id") ?? pick(custom, "appointmentId", "appointment_id"),
  };
}

/** "2026-10-01T10:00:00+02:00" → "jueves 1 de octubre a las 10:00" (hora de España). */
export function describeStart(start: string | null, timeZone: string | null): string | null {
  if (!start) return null;
  const ms = Date.parse(start);
  if (!Number.isFinite(ms)) return start; // texto ya legible de GHL
  let tz = "Europe/Madrid";
  try {
    if (timeZone) {
      new Intl.DateTimeFormat("es-ES", { timeZone });
      tz = timeZone;
    }
  } catch {
    /* zona no válida: España */
  }
  const d = new Date(ms);
  const day = new Intl.DateTimeFormat("es-ES", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(d);
  const time = new Intl.DateTimeFormat("es-ES", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${day} a las ${time}${tz === "Europe/Madrid" ? " (hora de España)" : ` (${tz})`}`;
}

export interface BookingMeta {
  start: string | null;
  when: string | null;
  appointment_id: string | null;
}

export function bookingOf(meta: Record<string, unknown> | null | undefined): BookingMeta | null {
  const b = meta?.booking as Partial<BookingMeta> | undefined;
  if (!b || typeof b !== "object") return null;
  return {
    start: typeof b.start === "string" ? b.start : null,
    when: typeof b.when === "string" ? b.when : null,
    appointment_id: typeof b.appointment_id === "string" ? b.appointment_id : null,
  };
}

/** Lo que el agente recibe en lugar de un mensaje del cliente. */
export function bookingInstruction(when: string | null): string {
  return (
    `[AVISO DEL SISTEMA — esto no lo ha escrito el cliente. ` +
    `El cliente acaba de reservar la llamada con Antonio${when ? ` para el ${when}` : ""}. ` +
    `Escríbele ahora siguiendo tus instrucciones para después de reservar: confírmale la llamada` +
    `${when ? " con el día y la hora" : ""}, dale las indicaciones para prepararla y envíale lo que tus instrucciones digan que se envía al reservar. ` +
    `No vuelvas a ofrecerle la agenda.]`
  );
}
