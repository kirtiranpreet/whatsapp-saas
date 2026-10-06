// Has this contact talked to the number before? Asked to Kapso, which stores
// every conversation of the number since it was connected — the ones the
// agent handles and the ones the owner answers from the WhatsApp Business App.

const KAPSO_WA_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";
const TIMEOUT_MS = 8_000;

/** A conversation opened this long before the message is not "this" message's. */
export const SAME_MESSAGE_SLACK_MS = 2 * 60 * 1000;

export interface KapsoConversationSummary {
  id: string;
  phone_number: string | null;
  created_at: string | null;
}

/** Digits only, for comparing numbers whatever format each side used. */
export function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

/** Same line when the digits match, allowing one side to drop the country code. */
export function samePhoneDigits(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 8 && long.endsWith(short);
}

/**
 * Pure decision: the contact is NEW only when, among the conversations Kapso
 * has with that number, there is none other than the current one, and the
 * current one was opened by this very message (not minutes or days earlier).
 */
export function isNewContactFromConversations(params: {
  conversations: KapsoConversationSummary[];
  contactPhone: string;
  currentConversationId: string | null;
  messageTime: string;
}): boolean {
  const contact = phoneDigits(params.contactPhone);
  const messageMs = Date.parse(params.messageTime);
  const cutoff = Number.isFinite(messageMs)
    ? messageMs - SAME_MESSAGE_SLACK_MS
    : Date.now() - SAME_MESSAGE_SLACK_MS;

  for (const conv of params.conversations) {
    // The API filters by number; this guards against a filter it ignored.
    if (conv.phone_number && !samePhoneDigits(phoneDigits(conv.phone_number), contact)) {
      continue;
    }
    const created = conv.created_at ? Date.parse(conv.created_at) : NaN;
    if (params.currentConversationId && conv.id === params.currentConversationId) {
      // The conversation this message belongs to: new only if it just opened.
      if (Number.isFinite(created) && created < cutoff) return false;
      continue;
    }
    // Any other conversation that already existed means they talked before.
    if (!Number.isFinite(created) || created < cutoff) return false;
  }
  return true;
}

export async function isNewContactByKapsoHistory(params: {
  apiKey: string;
  phoneNumberId: string;
  contactPhone: string;
  currentConversationId: string | null;
  messageTime: string;
}): Promise<boolean> {
  const conversations: KapsoConversationSummary[] = [];
  const digits = phoneDigits(params.contactPhone);
  // Kapso's own spelling first; a "+" variant only if that finds nothing.
  for (const phone of [digits, `+${digits}`]) {
    const url =
      `${KAPSO_WA_BASE}/${encodeURIComponent(params.phoneNumberId)}/conversations` +
      `?phone_number=${encodeURIComponent(phone)}&limit=100`;
    const res = await fetch(url, {
      headers: { "X-API-Key": params.apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Kapso conversations ${res.status}`);
    const body = (await res.json()) as { data?: unknown };
    const items = Array.isArray(body.data) ? body.data : [];
    for (const raw of items) {
      const c = raw as Record<string, unknown>;
      if (typeof c.id !== "string") continue;
      conversations.push({
        id: c.id,
        phone_number: typeof c.phone_number === "string" ? c.phone_number : null,
        created_at: typeof c.created_at === "string" ? c.created_at : null,
      });
    }
    if (conversations.length > 0) break;
  }

  return isNewContactFromConversations({
    conversations,
    contactPhone: params.contactPhone,
    currentConversationId: params.currentConversationId,
    messageTime: params.messageTime,
  });
}
