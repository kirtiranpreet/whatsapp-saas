/**
 * prompt-cache.ts — prompt caching on OpenRouter requests.
 *
 * buildSystemPrompt() puts everything that never changes between turns first
 * and marks where it ends with PROMPT_CACHE_BREAK. For Anthropic models that
 * marker becomes a cache breakpoint (`cache_control: ephemeral`, 1-hour TTL, on the fixed
 * part), so later turns re-read that part at a fraction of the price. For any
 * other model the marker is simply removed. Nothing else in the request
 * changes, so the model reads exactly the same text either way.
 */

import { PROMPT_CACHE_BREAK } from "./prompt-builder";

type ChatMessage = { role?: unknown; content?: unknown; [k: string]: unknown };

// 1-hour cache: writing it costs 2x the input price (5 minutes: 1.25x) and
// reading it 0.1x either way. With conversations spread through the day the
// 5-minute cache keeps expiring between messages and gets written again and
// again; one hour keeps it warm, so it is cheaper overall.
const CACHE_CONTROL = { type: "ephemeral", ttl: "1h" } as const;

function supportsCacheControl(model: unknown): boolean {
  return typeof model === "string" && model.startsWith("anthropic/");
}

/**
 * Rewrites a chat-completions request body. Returns the body unchanged when
 * no system message carries the marker.
 */
export function applyPromptCache(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages;
  if (!Array.isArray(messages)) return body;

  let changed = false;
  const cache = supportsCacheControl(body.model);
  const out = messages.map((m: ChatMessage) => {
    if (m?.role !== "system" || typeof m.content !== "string") return m;
    const idx = m.content.indexOf(PROMPT_CACHE_BREAK);
    if (idx === -1) return m;
    changed = true;
    const fixed = m.content.slice(0, idx).trimEnd();
    const rest = m.content.slice(idx + PROMPT_CACHE_BREAK.length).trimStart();
    if (!cache || !fixed) {
      return { ...m, content: [fixed, rest].filter(Boolean).join("\n\n") };
    }
    const parts: Array<Record<string, unknown>> = [
      { type: "text", text: fixed, cache_control: CACHE_CONTROL },
    ];
    if (rest) parts.push({ type: "text", text: rest });
    return { ...m, content: parts };
  });

  return changed ? { ...body, messages: out } : body;
}

/** fetch for createOpenAI({ fetch }): applies applyPromptCache to JSON bodies. */
export const promptCacheFetch: typeof fetch = async (input, init) => {
  if (init && typeof init.body === "string" && init.body.includes(PROMPT_CACHE_BREAK)) {
    try {
      const parsed = JSON.parse(init.body) as Record<string, unknown>;
      return fetch(input, { ...init, body: JSON.stringify(applyPromptCache(parsed)) });
    } catch {
      // Not JSON: send as it was.
    }
  }
  return fetch(input, init);
};
