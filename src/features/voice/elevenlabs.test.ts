import assert from "node:assert/strict";
import { test } from "node:test";
import {
  shouldReplyWithVoice,
  splitSpokenReply,
  voiceReplyOf,
} from "./elevenlabs.ts";

test("voiceReplyOf needs a mode that speaks and a voice", () => {
  assert.equal(voiceReplyOf(undefined), null);
  assert.equal(voiceReplyOf({ voiceReply: { mode: "off", voiceId: "v1" } }), null);
  assert.equal(voiceReplyOf({ voiceReply: { mode: "special", voiceId: "" } }), null);
  assert.deepEqual(voiceReplyOf({ voiceReply: { mode: "special", voiceId: " v1 " } }), {
    mode: "special",
    voiceId: "v1",
    voiceName: undefined,
  });
});

test("shouldReplyWithVoice follows the mode", () => {
  const v = (mode: "special" | "on_audio" | "always") => ({ mode, voiceId: "v1" });
  const none = { customerSentAudio: false, agentAsked: false };
  assert.equal(shouldReplyWithVoice(null, { customerSentAudio: true, agentAsked: true }), false);
  assert.equal(shouldReplyWithVoice(v("always"), none), true);
  assert.equal(shouldReplyWithVoice(v("on_audio"), none), false);
  assert.equal(shouldReplyWithVoice(v("on_audio"), { ...none, customerSentAudio: true }), true);
  assert.equal(shouldReplyWithVoice(v("special"), { ...none, customerSentAudio: true }), false);
  assert.equal(shouldReplyWithVoice(v("special"), { ...none, agentAsked: true }), true);
});

test("splitSpokenReply keeps links out of the audio and cleans formatting", () => {
  const { spoken, links } = splitSpokenReply(
    "¡Genial, *Marta*! 😊 Aquí tienes la agenda de Antonio: https://campus.example.com/widget/bookings/ish",
  );
  assert.deepEqual(links, ["https://campus.example.com/widget/bookings/ish"]);
  assert.equal(spoken, "¡Genial, Marta! Aquí tienes la agenda de Antonio.");
});

test("splitSpokenReply leaves plain speech as it is", () => {
  const { spoken, links } = splitSpokenReply("Te entiendo, es una decisión importante.");
  assert.deepEqual(links, []);
  assert.equal(spoken, "Te entiendo, es una decisión importante.");
});
