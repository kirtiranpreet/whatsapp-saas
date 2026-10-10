import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewContactFromConversations, samePhoneDigits } from "./kapso-history.ts";
import { isClearLead, parseVerdict } from "./first-message-classifier.ts";
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
  // Strict: anything that isn't a clear NUEVO stays with the owner.
  assert.equal(parseVerdict("no sé"), "personal");
  assert.equal(parseVerdict(""), "personal");
});

test("clear leads skip the model (real messages the model missed)", () => {
  for (const text of [
    "¡Hola! He completado el formulario y me gustaría recibir más información sobre vuestro negocio.\n\nFull name: X",
    "Hola buenas estoy interesado,gracias",
    "Tengo interés",
    "Hola,  me gustaría saber donde aprender y el coste.  Gracias",
    "Siempre me pareció interesante el hipnotismo",
    "Quiero información sobre la formación de Mallorca",
    "Hola, vi el anuncio",
  ]) {
    assert.equal(isClearLead(text), true, text);
  }
  for (const text of [
    "Hola",
    "Buenos días",
    "Me puedes pillar la crema esa de los orzuelos porfa",
    "Has llamado a la chica que te pase ayer?",
    "Holis, al final vienes ?",
    "Gracias por comunicarte con Amparo Barres ¿Cómo puedo ayudarte?💙",
  ]) {
    assert.equal(isClearLead(text), false, text);
  }
});

test("gate (default): every new number is answered, whatever it writes", async () => {
  const base = {
    workspaceId: "w", apiKey: "k", phoneNumberId: "p", contactPhone: "34600111222",
    kapsoConversationId: "c1", messageTime: NOW, text: "info",
  };
  let classified = false;
  const classify = async () => { classified = true; return "personal" as const; };
  for (const text of ["info", "Hola", "[Multimedia]", null]) {
    assert.deepEqual(
      await newContactGate({ ...base, text }, { checkHistory: async () => true, classify }),
      { answer: true, reason: "new_contact" },
      String(text),
    );
  }
  assert.equal(classified, false);
  assert.deepEqual(
    await newContactGate(base, { checkHistory: async () => false, classify }),
    { answer: false, reason: "kapso_history" },
  );
  assert.deepEqual(
    await newContactGate(base, {
      checkHistory: async () => { throw new Error("down"); },
      classify,
    }),
    { answer: false, reason: "history_check_failed" },
  );
});

test("gate (strict): history wins, then the first message, failures stay silent", async () => {
  const base = {
    workspaceId: "w", apiKey: "k", phoneNumberId: "p", contactPhone: "34600111222",
    kapsoConversationId: "c1", messageTime: NOW, text: "Hola Antonio, ¿cómo estás?",
    strictFirstMessage: true,
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
    { answer: false, reason: "personal_message" },
  );
  assert.equal(classified, false);
  assert.deepEqual(
    await newContactGate({ ...base, text: null }, {
      checkHistory: async () => true,
      classify: async () => "prospect",
    }),
    { answer: false, reason: "personal_message" },
  );
});
