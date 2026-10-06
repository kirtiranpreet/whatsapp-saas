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

function validZone(tz: string | null): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("es-ES", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** Minutes that `tz` is ahead of UTC at instant `ms`. */
function zoneOffsetMinutes(ms: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - ms) / 60000);
}

/**
 * The instant a booking starts. GHL sends startTime as a wall-clock time in
 * the booker's zone ("2026-10-07T06:20:00", selectedTimezone
 * "America/Montevideo") with no offset; reading that as UTC put the call hours
 * off. A value with an offset or "Z" is already absolute.
 */
export function bookingInstant(start: string, timeZone: string | null): number | null {
  const m = start.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (!m) {
    const ms = Date.parse(start);
    return Number.isFinite(ms) ? ms : null;
  }
  if (m[7]) {
    const ms = Date.parse(start);
    return Number.isFinite(ms) ? ms : null;
  }
  const tz = validZone(timeZone) ?? "Europe/Madrid";
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  let ms = naive - zoneOffsetMinutes(naive, tz) * 60000;
  ms = naive - zoneOffsetMinutes(ms, tz) * 60000;
  return ms;
}

/**
 * "jueves, 1 de octubre a las 10:00 (hora de España)". Always in Spain time,
 * where Antonio makes the call; when the booker is elsewhere, their own time
 * is added so the agent never has to convert.
 */
export function describeStart(start: string | null, timeZone: string | null): string | null {
  if (!start) return null;
  const ms = bookingInstant(start, timeZone);
  if (ms === null) return start; // texto ya legible de GHL
  const d = new Date(ms);
  const fmt = (tz: string) => ({
    day: new Intl.DateTimeFormat("es-ES", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(d),
    time: new Intl.DateTimeFormat("es-ES", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d),
  });
  const spain = fmt("Europe/Madrid");
  let text = `${spain.day} a las ${spain.time} (hora de España)`;
  const own = validZone(timeZone);
  if (own && own !== "Europe/Madrid") {
    const local = fmt(own);
    if (local.time !== spain.time || local.day !== spain.day) {
      text += `; para la persona, que está en otra zona horaria (${own}), son las ${local.time}${local.day !== spain.day ? ` del ${local.day}` : ""}`;
    }
  }
  return text;
}

export interface BookingMeta {
  start: string | null;
  when: string | null;
  appointment_id: string | null;
  /** El calendario en que reservó: decide qué texto usa el agente. */
  calendar?: string | null;
}

export function bookingOf(meta: Record<string, unknown> | null | undefined): BookingMeta | null {
  const b = meta?.booking as Partial<BookingMeta> | undefined;
  if (!b || typeof b !== "object") return null;
  return {
    start: typeof b.start === "string" ? b.start : null,
    when: typeof b.when === "string" ? b.when : null,
    appointment_id: typeof b.appointment_id === "string" ? b.appointment_id : null,
    calendar: typeof b.calendar === "string" ? b.calendar : null,
  };
}

/** Lo que el agente recibe en lugar de un mensaje del cliente. */
export function bookingInstruction(when: string | null, calendar: string | null = null): string {
  return (
    `[AVISO DEL SISTEMA — esto no lo ha escrito el cliente. ` +
    `El cliente acaba de reservar la llamada con Antonio${when ? ` para el ${when}` : ""}` +
    `${calendar ? ` en el calendario "${calendar}"` : ""}. ` +
    `${calendar ? "Usa los textos de después de reservar que corresponden a ese calendario. " : ""}` +
    `Escríbele ahora siguiendo tus instrucciones para después de reservar: confírmale la llamada` +
    `${when ? " con el día y la hora" : ""}, dale las indicaciones para prepararla y envíale lo que tus instrucciones digan que se envía al reservar. ` +
    `Si ahí se envía un material o una herramienta, pega su enlace completo en el mensaje: nunca la menciones sin el enlace. ` +
    `Usa exactamente el día y la hora de este aviso, sin convertirlos. ` +
    `Si ya le confirmaste esta llamada antes en la conversación, no la repitas. ` +
    `No vuelvas a ofrecerle la agenda.]`
  );
}

/**
 * A link that must reach whoever books a call (e.g. the "6 barreras" tool for
 * the training call). Configured per workspace on the WhatsApp integration as
 * config.booking_material = { url, calendar_contains? }.
 */
export interface BookingMaterial {
  url: string;
  /** Only for calendars whose name contains this text (any calendar if empty). */
  calendar_contains?: string;
}

export function bookingMaterialOf(config: unknown): BookingMaterial | null {
  const m = (config as { booking_material?: unknown } | null)?.booking_material as
    | Record<string, unknown>
    | undefined;
  if (!m || typeof m.url !== "string" || !/^https:\/\//.test(m.url)) return null;
  return {
    url: m.url,
    calendar_contains: typeof m.calendar_contains === "string" ? m.calendar_contains : undefined,
  };
}

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * The confirmation after a booking always carries the material link: when the
 * agent mentioned it without the URL (or forgot it), the link is appended.
 */
export function withBookingMaterial(
  text: string,
  calendar: string | null,
  material: BookingMaterial | null,
): string {
  if (!material) return text;
  if (material.calendar_contains) {
    if (!calendar || !normalize(calendar).includes(normalize(material.calendar_contains))) return text;
  }
  const bare = material.url.replace(/\/$/, "");
  if (text.includes(bare)) return text;
  return `${text.trimEnd()}\n\n${material.url}`;
}
