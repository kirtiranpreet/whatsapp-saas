// "Solo contactos nuevos" — for a number that is someone's PERSONAL WhatsApp
// (coexistence: the owner keeps using the Business App on their phone).
//
// When a conversation is opened for the first time in this app, the agent
// only answers if BOTH hold:
//   1. Kapso has no earlier conversation with that number (Kapso stores every
//      chat of the number since it was connected, including the ones the owner
//      handles from the phone), and
//   2. only with config.strict_first_message: the first message clearly asks
//      about the services (a bare greeting, media with no text or anything
//      doubtful stays with the owner). Without it, every new number is
//      answered and the agent retires itself if it isn't a prospect.
// Otherwise the conversation goes to a person (human_active) silently: the
// owner sees it on the phone as always and the agent never writes in it.
//
// Turned on per workspace with config.only_new_contacts on the Kapso
// integration. Off by default, so other workspaces behave as before.

import { isNewContactByKapsoHistory } from "./kapso-history.ts";
import { classifyFirstMessage } from "./first-message-classifier.ts";

export type GateVerdict =
  | { answer: true; reason: "new_contact" }
  | {
      answer: false;
      reason: "kapso_history" | "personal_message" | "history_check_failed";
    };

export interface GateInput {
  workspaceId: string;
  apiKey: string;
  phoneNumberId: string;
  /** Contact's number as the webhook sent it */
  contactPhone: string;
  /** Kapso's conversation id for this message, if the webhook carried it */
  kapsoConversationId: string | null;
  /** When the inbound message was sent (ISO) */
  messageTime: string;
  /** Text of the first message (caption / transcript-less media gives null) */
  text: string | null;
  /**
   * Also require the first message to clearly ask about the services
   * (config.strict_first_message). Off: every new number is answered.
   */
  strictFirstMessage?: boolean;
}

export interface GateDeps {
  checkHistory?: typeof isNewContactByKapsoHistory;
  classify?: typeof classifyFirstMessage;
}

export async function newContactGate(
  input: GateInput,
  deps: GateDeps = {},
): Promise<GateVerdict> {
  const checkHistory = deps.checkHistory ?? isNewContactByKapsoHistory;
  const classify = deps.classify ?? classifyFirstMessage;

  let isNew: boolean;
  try {
    isNew = await checkHistory({
      apiKey: input.apiKey,
      phoneNumberId: input.phoneNumberId,
      contactPhone: input.contactPhone,
      currentConversationId: input.kapsoConversationId,
      messageTime: input.messageTime,
    });
  } catch (err) {
    // Fail closed: on a personal number, answering a friend is worse than a
    // lead waiting for the owner, who sees every message on the phone anyway.
    console.error(
      "[new-contact-gate] Kapso history check failed:",
      err instanceof Error ? err.message : "unknown",
    );
    return { answer: false, reason: "history_check_failed" };
  }
  if (!isNew) return { answer: false, reason: "kapso_history" };

  // Default: a number that never wrote before is always answered, whatever the
  // first message ("Hola", "info", a photo…). The agent itself retires with
  // [[NO_ES_CLIENTE]] if the chat turns out not to be a prospect.
  if (!input.strictFirstMessage) return { answer: true, reason: "new_contact" };

  // Strict mode (config.strict_first_message): only a first message that
  // clearly asks about the services is answered. A photo, audio, contact card
  // or link with no text is left to the owner.
  const text = input.text?.trim();
  if (!text || text === "[Multimedia]") {
    return { answer: false, reason: "personal_message" };
  }
  const verdict = await classify({ workspaceId: input.workspaceId, text });
  if (verdict === "personal") return { answer: false, reason: "personal_message" };

  return { answer: true, reason: "new_contact" };
}
