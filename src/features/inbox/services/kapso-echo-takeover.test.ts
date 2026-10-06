import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOutboundEcho, parseHistorySync, parseInbound } from "./kapso-webhook-handler.ts";

const echo = (type: string, extra: Record<string, unknown> = {}) => ({
  message: {
    id: "wamid.X",
    to: "34611405518",
    type,
    timestamp: "1791310000",
    kapso: { origin: "business_app" },
    ...extra,
  },
  phone_number_id: "1218553087998914",
});

test("the owner's text or voice note from the phone takes the chat over", () => {
  assert.ok(parseOutboundEcho(echo("text", { text: { body: "Hola" } }), "whatsapp.message.sent"));
  assert.ok(parseOutboundEcho(echo("audio", { audio: { id: "m1" } }), "whatsapp.message.sent"));
});

test("a reaction, a sticker or deleting a message does not", () => {
  assert.equal(parseOutboundEcho(echo("reaction", { reaction: { emoji: "❤️" } }), "whatsapp.message.sent"), null);
  assert.equal(parseOutboundEcho(echo("sticker", { sticker: { id: "s" } }), "whatsapp.message.sent"), null);
  assert.equal(parseOutboundEcho(echo("revoke"), "whatsapp.message.sent"), null);
});

test("history backfill is never live", () => {
  const body = {
    message: { id: "w", from: "34600111222", type: "text", text: { body: "hola" }, kapso: { origin: "history_sync" } },
    conversation: { phone_number: "34600111222" },
  };
  assert.deepEqual(parseHistorySync(body, "whatsapp.message.received"), { phone: "34600111222", name: null });
  assert.equal(parseInbound(body, "whatsapp.message.received"), null);
});
