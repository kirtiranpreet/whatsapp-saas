// Oportunidades calientes y leads en riesgo. Se calcula al momento (no en el
// informe semanal) con señales observables:
//   · tiempos reales del último mensaje del cliente y del negocio;
//   · señales de compra detectadas en los mensajes del cliente (con el mensaje);
//   · el último análisis guardado de la conversación, si existe;
//   · hechos del sistema: llamada agendada, cliente en el CRM.
// Que alguien no responda NO lo marca como perdido: el estado describe el
// tiempo sin respuesta y el motivo se explica con las señales que lo causan.

export interface FollowUpInput {
  conversationId: string;
  contactLabel: string;
  conversationState: string;
  lastCustomerAt: string | null;
  lastBusinessAt: string | null;
  lastCustomerText: string | null;
  lastCustomerQuestion: { text: string; at: string; messageId: string } | null;
  lastBusinessText: string | null;
  customerMessages: Array<{ id: string; text: string; at: string }>;
  appointmentBooked: boolean;
  isCustomer: boolean;
  analyzed: {
    intent: "alta" | "media" | "baja";
    outcome: string;
    funnelStage: string;
    mainObjection: string | null;
  } | null;
}

export type FollowUpStatus =
  | "sin_responder"
  | "activa"
  | "seguimiento_pendiente"
  | "enfriandose"
  | "alto_riesgo"
  | "cerrada";

export type Priority = "alta" | "media" | "baja";

export interface BuyingSignal {
  signal: string;
  message_id: string;
  at: string;
  quote: string;
}

export interface FollowUpItem {
  conversation_id: string;
  contact: string;
  status: FollowUpStatus;
  priority: Priority;
  score: number;
  hours_since_customer: number | null;
  last_customer_at: string | null;
  last_customer_text: string | null;
  last_business_text: string | null;
  last_question: FollowUpInput["lastCustomerQuestion"];
  intent: "alta" | "media" | "baja";
  intent_source: "analisis" | "senales" | "sin_datos";
  signals: BuyingSignal[];
  stage: string | null;
  friction: string | null;
  reasons: string[];
  next_action: string;
}

/** Expresiones de compra observables. Se busca en el texto del cliente. */
const SIGNAL_PATTERNS: Array<{ signal: string; re: RegExp }> = [
  { signal: "Pregunta cómo pagar", re: /\b(c[oó]mo (lo )?pago|c[oó]mo (se )?paga|forma(s)? de pago|m[eé]todo(s)? de pago|transferencia|bizum|tarjeta|paypal|pagar en (cuotas|plazos))\b/i },
  { signal: "Pide el enlace", re: /\b(p[aá]same|me (pasas|mandas|env[ií]as)|env[ií]ame|manda(me)?)\b.{0,20}\b(enlace|link)\b|\b(el|un) (enlace|link) (de|para) (pago|inscripci[oó]n|reservar)\b/i },
  { signal: "Pregunta fechas o disponibilidad", re: /\b(qu[eé] fechas?|cu[aá]ndo (es|empieza|empezamos|comienza|ser[ií]a|podr[ií]a empezar)|hay plazas?|quedan plazas?|disponibilidad|pr[oó]xima (edici[oó]n|fecha))\b/i },
  { signal: "Pregunta qué incluye o condiciones", re: /\b(qu[eé] incluye|qu[eé] trae|condiciones|garant[ií]a|devoluci[oó]n|certificado)\b/i },
  { signal: "Dice que quiere hacerlo", re: /\b(me interesa|quiero (hacerlo|apuntarme|inscribirme|reservar|empezar)|me apunto|c[oó]mo me (apunto|inscribo)|cuenta conmigo|reserv(o|ar) (mi )?plaza)\b/i },
];

export function detectSignals(messages: FollowUpInput["customerMessages"]): BuyingSignal[] {
  const found = new Map<string, BuyingSignal>();
  for (const m of messages) {
    for (const p of SIGNAL_PATTERNS) {
      // Una vez por tipo de señal: la más reciente.
      if (p.re.test(m.text)) {
        const prev = found.get(p.signal);
        if (!prev || prev.at < m.at) {
          found.set(p.signal, { signal: p.signal, message_id: m.id, at: m.at, quote: m.text.slice(0, 300) });
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => b.at.localeCompare(a.at));
}

const HOUR = 3600_000;

function hoursBetween(from: string | null, now: number): number | null {
  if (!from) return null;
  return Math.max(0, Math.round(((now - Date.parse(from)) / HOUR) * 10) / 10);
}

export function classifyFollowUp(input: FollowUpInput, now: number): FollowUpItem {
  const signals = detectSignals(input.customerMessages);
  const hours = hoursBetween(input.lastCustomerAt, now);
  const reasons: string[] = [];

  // Intención: el análisis guardado manda; si no hay, las señales observables.
  let intent: FollowUpItem["intent"] = "baja";
  let intentSource: FollowUpItem["intent_source"] = "sin_datos";
  if (input.analyzed) {
    intent = input.analyzed.intent;
    intentSource = "analisis";
  } else if (signals.length > 0) {
    intent = signals.length >= 2 ? "alta" : "media";
    intentSource = "senales";
  }

  const closedOutcome = input.analyzed && ["compro", "rechazo"].includes(input.analyzed.outcome);
  let status: FollowUpStatus;
  if (input.isCustomer || input.appointmentBooked || closedOutcome || input.conversationState === "closed") {
    status = "cerrada";
    if (input.isCustomer) reasons.push("Figura como cliente en el CRM");
    if (input.appointmentBooked) reasons.push("Tiene una llamada agendada");
    if (closedOutcome) reasons.push(input.analyzed!.outcome === "compro" ? "El análisis registra la compra" : "Rechazó explícitamente");
  } else if (
    input.lastCustomerAt &&
    (!input.lastBusinessAt || input.lastCustomerAt > input.lastBusinessAt)
  ) {
    status = "sin_responder";
    reasons.push("El último mensaje es del cliente y no tiene respuesta");
  } else if (hours === null) {
    status = "activa";
  } else if (hours < 24) {
    status = "activa";
  } else if (hours < 72) {
    status = "seguimiento_pendiente";
    reasons.push(`Sin respuesta del cliente desde hace ${Math.floor(hours)} h`);
  } else if (hours < 168) {
    status = "enfriandose";
    reasons.push(`Sin respuesta del cliente desde hace ${Math.floor(hours / 24)} días`);
  } else {
    status = "alto_riesgo";
    reasons.push(`Sin respuesta del cliente desde hace ${Math.floor(hours / 24)} días`);
  }

  for (const s of signals.slice(0, 3)) reasons.push(`Señal: ${s.signal.toLowerCase()}`);
  if (input.analyzed?.mainObjection) reasons.push(`Objeción detectada: ${input.analyzed.mainObjection}`);

  // Puntuación transparente: tiempo + intención + señales.
  const statusScore: Record<FollowUpStatus, number> = {
    sin_responder: 40,
    seguimiento_pendiente: 30,
    enfriandose: 25,
    alto_riesgo: 15,
    activa: 10,
    cerrada: 0,
  };
  const intentScore = { alta: 40, media: 20, baja: 0 }[intent];
  const score = status === "cerrada" ? 0 : statusScore[status] + intentScore + Math.min(signals.length, 3) * 5;
  const priority: Priority = score >= 60 ? "alta" : score >= 35 ? "media" : "baja";

  return {
    conversation_id: input.conversationId,
    contact: input.contactLabel,
    status,
    priority,
    score,
    hours_since_customer: hours,
    last_customer_at: input.lastCustomerAt,
    last_customer_text: input.lastCustomerText,
    last_business_text: input.lastBusinessText,
    last_question: input.lastCustomerQuestion,
    intent,
    intent_source: intentSource,
    signals,
    stage: input.analyzed?.funnelStage ?? null,
    friction: input.analyzed?.mainObjection ?? null,
    reasons,
    next_action: nextAction(status, intent, input),
  };
}

function nextAction(status: FollowUpStatus, intent: FollowUpItem["intent"], input: FollowUpInput): string {
  if (status === "cerrada") {
    return input.appointmentBooked ? "Preparar la llamada agendada" : "Ninguna por ahora";
  }
  if (status === "sin_responder") return "Responder hoy: hay un mensaje del cliente sin contestar";
  if (intent === "alta") return "Contactar hoy: mostró intención de compra";
  if (input.analyzed?.mainObjection) return `Seguimiento que aborde la objeción (${input.analyzed.mainObjection})`;
  if (status === "seguimiento_pendiente") return "Enviar un seguimiento breve";
  if (status === "enfriandose") return "Reactivar con algo de valor, sin presionar";
  if (status === "alto_riesgo") return "Último intento de contacto o archivar";
  return "Dejar que la conversación siga";
}
