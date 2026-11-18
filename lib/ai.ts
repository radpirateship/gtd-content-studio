import { withRetry } from './retry';
/**
 * Shared AI helper — calls the Anthropic API directly via fetch.
 * All routes import this single function instead of managing their own API calls.
 * Reads ANTHROPIC_API_KEY lazily at call time (not module-load time).
 *
 * v2: model is env-configurable (AI_MODEL), with retry/backoff on transient
 * errors (429/5xx/network), a 90s per-attempt timeout, and truncation detection.
 */

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 90_000;

// ── Reasoning leak guard ─────────────────────────────────────────────────────
// Extended thinking is never enabled on these calls, but the model will
// occasionally narrate its plan inline ("<thinking> The user wants me to...")
// before, or instead of, the requested output. Short max_tokens budgets make
// it worse: the narration eats the budget and the closing tag never arrives,
// so the whole block lands verbatim in the article. Every response passes
// through here so no call site can leak it.
const REASONING_OPENERS =
  /^\s*(?:(?:okay|ok|alright|sure|great)[,.!]?\s*)?(?:the user (?:wants|asks|is asking|needs)|let me (?:craft|write|think|draft|start|create|produce)|i need to|i should|i will|i'll (?:write|craft|create|draft)|first,? (?:let me|i)|here(?:'s| is) (?:my|the) (?:plan|thinking|approach)|my (?:task|job) is)/i;

export function stripReasoning(raw: string): string {
  let text = raw ?? "";
  if (!text) return text;

  // Closed <thinking>/<reasoning>/<scratchpad> blocks: remove wholesale.
  text = text.replace(/<\s*(thinking|reasoning|scratchpad|thought|plan)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");

  // Unclosed block: the model ran out of tokens mid-reasoning. Keep the
  // final quoted deliverable if it wrote one, otherwise drop everything.
  const open = text.search(/<\s*(thinking|reasoning|scratchpad|thought|plan)\b[^>]*>/i);
  if (open !== -1) {
    const block = text.slice(open);
    const before = text.slice(0, open);
    text = before.trim() ? before : recoverQuotedDeliverable(block);
  }

  // Plain meta-commentary preamble with no tags. Only treat it as a leak
  // when the first line reads like narration; then keep the last quoted
  // deliverable, or the text after the first blank line, whichever exists.
  if (REASONING_OPENERS.test(text)) {
    const recovered = recoverQuotedDeliverable(text);
    if (recovered) text = recovered;
    else {
      const idx = text.search(/\n\s*\n/);
      text = idx !== -1 ? text.slice(idx).trim() : "";
    }
  }

  return text.trim();
}

function recoverQuotedDeliverable(block: string): string {
  // Prefer a quoted passage that starts with markup or a capital letter and is
  // long enough to be the actual deliverable rather than a quoted phrase.
  const candidates = [...block.matchAll(/"((?:<[^"]*|[A-Z])[^"]{40,})"/g)].map((m) => m[1].trim());
  if (candidates.length) return candidates[candidates.length - 1];
  // JSON deliverables inside narration.
  const json = block.match(/(\[[\s\S]*\]|\{[\s\S]*\})\s*$/);
  if (json) return json[1].trim();
  return "";
}

/** True when text still reads like model narration rather than the deliverable. */
export function looksLikeReasoning(text: string): boolean {
  if (!text) return false;
  return /<\s*\/?\s*(thinking|reasoning|scratchpad)\b/i.test(text) || REASONING_OPENERS.test(text);
}

export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; model?: string; timeoutMs?: number; retryOnTimeout?: boolean }
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it in Vercel -> Settings -> Environment Variables."
    );
  }

  const model = options?.model ?? process.env.AI_MODEL ?? "claude-sonnet-4-6";
  const maxTokens = options?.maxTokens ?? 4096;
  // Large generations (long articles, comparison tables) can take well over the
  // default 90s. Callers can raise this; the route's maxDuration must cover it.
  const attemptTimeoutMs = options?.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  // For long single-shot calls a post-timeout retry can't fit in the function
  // budget and just turns a clean failure into a hung 504 — callers can disable it.
  const retryOnTimeout = options?.retryOnTimeout ?? true;

  let lastError: Error = new Error("AI generation failed");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ai] Anthropic API error (attempt ${attempt}/${MAX_ATTEMPTS}):`, response.status, errorText.slice(0, 300));
        let msg = "AI generation failed";
        try {
          msg = JSON.parse(errorText).error?.message || msg;
        } catch {
          msg = errorText || msg;
        }
        lastError = new Error(msg);

        if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
          const retryAfter = Number(response.headers.get("retry-after")) || 0;
          const backoffMs = Math.max(retryAfter * 1000, 1500 * 2 ** (attempt - 1));
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw lastError;
      }

      const data = await response.json();

      if (data.stop_reason === "max_tokens") {
        // Output was cut off mid-generation. Surface it loudly: a truncated
        // article silently breaks HTML structure downstream.
        console.warn(`[ai] Response truncated at max_tokens=${maxTokens} (model ${model}). Consider a higher limit.`);
      }

      const rawText: string = data.content?.[0]?.text || "";
      const cleaned = stripReasoning(rawText);
      if (cleaned !== rawText.trim()) {
        console.warn(`[ai] Stripped leaked reasoning from response (${rawText.length} -> ${cleaned.length} chars).`);
      }
      return cleaned;
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "TimeoutError";
      const isNetwork = err instanceof TypeError; // fetch network failures
      lastError = err instanceof Error ? err : new Error(String(err));

      if ((isNetwork || (isAbort && retryOnTimeout)) && attempt < MAX_ATTEMPTS) {
        console.warn(`[ai] ${isAbort ? "Timeout" : "Network error"} on attempt ${attempt}/${MAX_ATTEMPTS}, retrying...`);
        await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError;
}

// ── callAIFull: structured response with truncation metadata (used by revamp) ──
const CALLFULL_TIMEOUT_MS = 90_000;

export interface AIResponse {
  text: string;
  stopReason: string;
  truncated: boolean;
}

export async function callAIFull(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; model?: string; timeoutMs?: number }
): Promise<AIResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Set it in Vercel -> Settings -> Environment Variables.");
  }
  const model = options?.model ?? process.env.AI_MODEL ?? "claude-sonnet-4-6";
  const maxTokens = options?.maxTokens ?? 4096;
  const timeoutMs = options?.timeoutMs ?? CALLFULL_TIMEOUT_MS;

  return withRetry(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: "user", content: userPrompt }] }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`AI request timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new Error("Could not reach the Anthropic API. Check the connection and try again.");
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ai] Anthropic API error:", response.status, errorText.slice(0, 300));
      if (response.status === 401) throw new Error("Invalid Anthropic API key.");
      if (response.status === 429) throw new Error("AI rate limit reached (status: 429). Wait a minute and try again.");
      if (response.status === 529) throw new Error("Anthropic API temporarily overloaded (status: 529). Try again shortly.");
      let msg = "AI generation failed";
      try { msg = JSON.parse(errorText).error?.message || msg; } catch { msg = errorText || msg; }
      if (response.status >= 500) throw new Error(`AI generation failed (status: ${response.status}): ${msg}`);
      throw new Error(msg);
    }
    const data = await response.json();
    const text = stripReasoning(data.content?.[0]?.text || "");
    const stopReason = data.stop_reason || "unknown";
    const truncated = stopReason === "max_tokens";
    if (truncated) console.warn(`[ai] callAIFull response TRUNCATED at max_tokens=${maxTokens}.`);
    if (!text || text.trim().length < 20) {
      throw new Error("AI returned an empty response. Adjust inputs and try again.");
    }
    return { text, stopReason, truncated };
  }, { label: "Anthropic", maxRetries: 2 });
}
