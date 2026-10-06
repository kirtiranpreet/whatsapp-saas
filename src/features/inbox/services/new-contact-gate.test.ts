import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewContactFromConversations, samePhoneDigits } from "./kapso-history.ts";
import { parseVerdict } from "./first-message-classifier.ts";
import { newContactGate } from "./new-contact-gate.ts";

const NOW = "2026-10-06T18:00:00.000Z";
const minutesBefore = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString();

test("brand-new contact: only the conversation this message just opened", () => {
  assert.equal(
    isNewContactFromConversations({
      conversations: [{ id: "c1", phone_number: "34600111222", created_at: NOW }],
      contactPhone: "34600111222",
      currentConversationId: "c1",
      messageTime: NOW,
    }),
    true,
  );
  assert.equal(
    isNewContactFromConversations({
      conversations: [],
      contactPhone: "34600111222",
      currentConversationId: null,
      messageTime: NOW,
    }),
    true,
  );
});

test("an earlier conversation means they already talked", () => {
  assert.equal(
    isNewContactFromConversations({
      conversations: [
        { id: "c2", phone_number: "34600111222", created_at: NOW },
        { id: "c1", phone_number: "34600111222", created_at: minutesBefore(3 * 24 * 60) },
      ],
      contactPhone: "34600111222",
      currentConversationId: "c2",
      messageTime: NOW,
    }),
    false,
  );
});

test("the current conversation opened earlier (owner chatted today) is not new", () => {
  assert.equal(
    isNewContactFromConversations({
      conversations: [{ id: "c1", phone_number: "+34600111222", created_at: minutesBefore(45) }],
      contactPhone: "34600111222",
      currentConversationId: "c1",
      messageTime: NOW,
    }),
    false,
  );
});

test("other numbers returned by the API are ignored", () => {
  assert.equal(
    isNewContactFromConversations({
      conversations: [{ id: "x", phone_number: "59899000000", created_at: minutesBefore(600) }],
      contactPhone: "34600111222",
      currentConversationId: null,
      messageTime: NOW,
    }),
    true,
  );
  assert.equal(samePhoneDigits("34600111222", "600111222"), true);
  assert.equal(samePhoneDigits("34600111222", "34600111223"), false);
});

test("classifier verdict parsing", () => {
  assert.equal(parseVerdict("CONOCIDO"), "personal");
  assert.equal(parseVerdict(" conocido."), "personal");
  assert.equal(parseVerdict("NUEVO"), "prospect");
  assert.equal(parseVerdict("no sé"), "prospect");
});

test("gate: history wins, then the first message, failures stay silent", async () => {
  const base = {
    workspaceId: "w", apiKey: "k", phoneNumberId: "p", contactPhone: "34600111222",
    kapsoConversationId: "c1", messageTime: NOW, text: "Hola Antonio, ¿cómo estás?",
  };
  assert.deepEqual(
    await newContactGate(base, { checkHistory: async () => false, classify: async () => "prospect" }),
    { answer: false, reason: "kapso_history" },
  );
  assert.deepEqual(
    await newContactGate(base, { checkHistory: async () => true, classify: async () => "personal" }),
    { answer: false, reason: "personal_message" },
  );
  assert.deepEqual(
    await newContactGate(base, { checkHistory: async () => true, classify: async () => "prospect" }),
    { answer: true, reason: "new_contact" },
  );
  assert.deepEqual(
    await newContactGate(base, {
      checkHistory: async () => { throw new Error("down"); },
      classify: async () => "prospect",
    }),
    { answer: false, reason: "history_check_failed" },
  );
  let classified = false;
  assert.deepEqual(
    await newContactGate({ ...base, text: "[Multimedia]" }, {
      checkHistory: async () => true,
      classify: async () => { classified = true; return "personal"; },
    }),
    { answer: true, reason: "new_contact" },
  );
  assert.equal(classified, false);
});
