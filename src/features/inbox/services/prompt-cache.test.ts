import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPromptCache } from "./prompt-cache.ts";
import { buildSystemPrompt, PROMPT_CACHE_BREAK } from "./prompt-builder.ts";

const system = buildSystemPrompt({
  nowContext: "AHORA: lunes 10:00",
  bizContext: "NEGOCIO",
  promptBase: "PROMPT BASE",
  summary: "RESUMEN",
  kbContext: "KB",
  guardrails: { rules: ["REGLA"] },
});

test("buildSystemPrompt puts the fixed part before the cache break and per-turn context after it", () => {
  const [fixed, perTurn] = system.split(PROMPT_CACHE_BREAK);
  assert.ok(fixed.includes("PROMPT BASE"));
  for (const t of ["AHORA", "RESUMEN", "NEGOCIO", "KB", "REGLA"]) {
    assert.ok(!fixed.includes(t), `${t} must not be in the cached part`);
    assert.ok(perTurn.includes(t), `${t} must be after the break`);
  }
  // Guardrails and the tool-honesty note still close the prompt.
  assert.ok(perTurn.indexOf("REGLA") > perTurn.indexOf("KB"));
  assert.ok(perTurn.indexOf("## Honestidad sobre tus capacidades") > perTurn.indexOf("REGLA"));
});

test("for Anthropic models the fixed part becomes a cached text part", () => {
  const body = applyPromptCache({
    model: "anthropic/claude-sonnet-4.6",
    messages: [
      { role: "system", content: system },
      { role: "user", content: "hola" },
    ],
  });
  const msgs = body.messages as Array<{ role: string; content: unknown }>;
  const parts = msgs[0].content as Array<{ type: string; text: string; cache_control?: unknown }>;
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].cache_control, { type: "ephemeral" });
  assert.ok(parts[0].text.includes("PROMPT BASE"));
  assert.equal(parts[1].cache_control, undefined);
  assert.ok(parts[1].text.includes("AHORA"));
  assert.ok(!JSON.stringify(body).includes(PROMPT_CACHE_BREAK));
  assert.equal(msgs[1].content, "hola");
});

test("for other models the marker is removed and the text stays a plain string", () => {
  const body = applyPromptCache({
    model: "openai/gpt-4o-mini",
    messages: [{ role: "system", content: system }],
  });
  const content = (body.messages as Array<{ content: unknown }>)[0].content;
  assert.equal(typeof content, "string");
  assert.ok(!(content as string).includes(PROMPT_CACHE_BREAK));
  assert.ok((content as string).includes("PROMPT BASE") && (content as string).includes("AHORA"));
});

test("a body without the marker is returned untouched", () => {
  const original = { model: "anthropic/claude-sonnet-4.6", messages: [{ role: "system", content: "x" }] };
  assert.equal(applyPromptCache(original), original);
});
