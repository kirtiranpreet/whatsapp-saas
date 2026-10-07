import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dueFollowUp,
  finalFollowUpAt,
  followUpConfigOf,
  followUpInstruction,
  followUpOf,
  isNoSendReply,
  isQuiet,
} from "./follow-up-plan.ts";

const cfg = followUpConfigOf({ followUps: { enabled: true } }); // Europe/Madrid, 22-9
const H = 3_600_000;
// 2026-10-06 is CEST (UTC+2): 10:00 Madrid = 08:00 UTC.
const madrid = (hh: number, mm = 0, day = 6) => Date.UTC(2026, 9, day, hh - 2, mm);

test("config defaults and validation", () => {
  assert.equal(followUpConfigOf(undefined).enabled, false);
  assert.deepEqual(cfg.delaysMinutes, [60, 300, 1350]);
  assert.equal(cfg.timeZone, "Europe/Madrid");
  assert.equal(followUpConfigOf({ followUps: { enabled: true, timeZone: "Nope/Zone" } }).timeZone, "Europe/Madrid");
});

test("quiet hours in Madrid time", () => {
  assert.equal(isQuiet(madrid(21, 59), cfg), false);
  assert.equal(isQuiet(madrid(22, 0), cfg), true);
  assert.equal(isQuiet(madrid(8, 59), cfg), true);
  assert.equal(isQuiet(madrid(9, 0), cfg), false);
});

test("daytime sequence: 1h, 5h, then the last one", () => {
  const lastIn = madrid(10);
  const st = (sent: number, lastFu: number | null) => ({ lastInboundAt: lastIn, sent, lastFollowUpAt: lastFu });
  assert.equal(dueFollowUp(st(0, null), lastIn + 30 * 60_000, cfg), null);
  assert.equal(dueFollowUp(st(0, null), lastIn + H, cfg), 1);
  assert.equal(dueFollowUp(st(1, lastIn + H), lastIn + 3 * H, cfg), null);
  assert.equal(dueFollowUp(st(1, lastIn + H), lastIn + 5 * H, cfg), 2);
  // 22.5 h after 10:00 is 08:30 (quiet); the window closes at 09:40: it goes out at 09:00.
  assert.equal(dueFollowUp(st(2, lastIn + 5 * H), madrid(21, 45), cfg), null);
  assert.equal(dueFollowUp(st(2, lastIn + 5 * H), madrid(8, 50, 7), cfg), null);
  assert.equal(dueFollowUp(st(2, lastIn + 5 * H), madrid(9, 0, 7), cfg), 3);
  assert.equal(dueFollowUp(st(3, madrid(9, 0, 7)), madrid(9, 10, 7), cfg), null);
});

test("the last one moves to the evening before when the morning is too late", () => {
  // Wrote at 08:00: the window closes at 07:40 next day, before the quiet ends.
  const lastIn = madrid(8);
  assert.equal(finalFollowUpAt(lastIn, cfg), madrid(21, 30));
  assert.equal(dueFollowUp({ lastInboundAt: lastIn, sent: 2, lastFollowUpAt: madrid(13) }, madrid(21, 20), cfg), null);
  assert.equal(dueFollowUp({ lastInboundAt: lastIn, sent: 2, lastFollowUpAt: madrid(13) }, madrid(21, 30), cfg), 3);
});

test("never at night, and waits for the morning", () => {
  const lastIn = madrid(21, 30);
  const st = { lastInboundAt: lastIn, sent: 0, lastFollowUpAt: null };
  assert.equal(dueFollowUp(st, madrid(23), cfg), null);
  assert.equal(dueFollowUp(st, madrid(9, 0, 7), cfg), 1);
});

test("never after the 24h window, never too close together", () => {
  const lastIn = madrid(12);
  assert.equal(dueFollowUp({ lastInboundAt: lastIn, sent: 2, lastFollowUpAt: lastIn + 5 * H }, lastIn + 23.9 * H, cfg), null);
  assert.equal(dueFollowUp({ lastInboundAt: lastIn, sent: 0, lastFollowUpAt: lastIn + 4.5 * H }, lastIn + 5 * H, cfg), null);
});

test("instruction, meta and no-send", () => {
  assert.match(followUpInstruction(3, 21.6), /seguimiento 3 de 3, el último/);
  assert.match(followUpInstruction(1, 0.4), /1 hora\b/);
  assert.deepEqual(followUpOf({ follow_up: { step: 2, after: "2026-10-06T08:00:00Z" } }), {
    step: 2,
    after: "2026-10-06T08:00:00Z",
  });
  assert.equal(followUpOf({ follow_up: { step: 4, after: "x" } }), null);
  assert.equal(isNoSendReply("NO_ENVIAR"), true);
  assert.equal(isNoSendReply("¿Sigues por ahí, Marta?"), false);
});

test("not-a-client token: detected and never sent", async () => {
  const { isNotAClientReply, stripNotAClientToken, NOT_A_CLIENT_TOKEN } = await import("./follow-up-plan.ts");
  assert.equal(isNotAClientReply(NOT_A_CLIENT_TOKEN), true);
  assert.equal(isNotAClientReply(`  ${NOT_A_CLIENT_TOKEN}\n`), true);
  assert.equal(isNotAClientReply("Hola, ¿cómo te llamas?"), false);
  assert.equal(stripNotAClientToken(`Gracias. ${NOT_A_CLIENT_TOKEN}`), "Gracias.");
});
