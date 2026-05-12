import "server-only"
import { generateObject, generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { z } from "zod"
import type { ValidationRule } from "@/lib/types"
import { getCanonicalSiteUrl } from "@/lib/site-url"

// ── Model configuration ────────────────────────────────────────────────────
// Uses OpenRouter as the LLM provider for validation, summarisation, and
// vision. OpenRouter provides a single OpenAI-compatible gateway to dozens
// of models — the same key that powers Smart AI chat.
//
// Env-var overrides are preserved so you can swap models on Railway without
// redeploying. The DO_* vars are checked first for backwards-compat.
const provider = createOpenAI({
  baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || process.env.DO_AI_API_KEY || "",
  headers: {
    "HTTP-Referer": getCanonicalSiteUrl(),

    "X-Title": "Hierarchia Validation Pipeline",
  },
});

// Override via env vars for A/B testing or model upgrades.
// Gemini 3.1 Pro Preview is fast, cheap, handles structured output well, and
// supports vision natively — ideal for all three pipeline stages.
const MODEL = process.env.DO_VALIDATION_MODEL || process.env.VALIDATION_MODEL || "google/gemini-3.1-pro-preview"
const SUMMARY_MODEL = process.env.DO_SUMMARY_MODEL || process.env.SUMMARY_MODEL || "anthropic/claude-sonnet-4-6"
const VISION_MODEL = process.env.DO_VISION_MODEL || process.env.VISION_MODEL || "google/gemini-3.1-pro-preview"

// Per-LLM-call hard timeout. On Railway each call runs in the same
// persistent Node process, so we set a generous 45s to fit within the
// pipeline budget (default 50s).
const LLM_CALL_TIMEOUT_MS = Number(process.env.LLM_CALL_TIMEOUT_MS ?? 45_000)

// Bumped whenever the system prompt or schema changes so we can compare
// historical runs in `validation_runs.prompt_version`.
//   v7: split scored vs binary rule_type prompts; tightened rubric escape;
//       added safety-filter detection + fallback-model chain.
export const PROMPT_VERSION = "v7"

// Optional fallback model. When the primary model fails with a transient
// service error (503 / UNAVAILABLE / RESOURCE_EXHAUSTED) after retries,
// we swap to this model for a single salvage attempt. Setting an empty
// string disables the fallback.
const FALLBACK_VALIDATION_MODEL =
  process.env.FALLBACK_VALIDATION_MODEL ??
  process.env.DO_FALLBACK_VALIDATION_MODEL ??
  "anthropic/claude-sonnet-4-6"

/**
 * Recognise Gemini / OpenAI safety-filter rejections. These are permanent
 * errors (no point retrying) and should surface to the user with an
 * explanatory flag, not a generic "rule failed".
 */
export function isSafetyFilterError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /\b(SAFETY|BLOCKED|content[_ ]?policy|finish_reason["']?\s*:\s*["']?(safety|blocklist|content_filter)|content filter|recitation)\b/i.test(
    msg,
  )
}

/**
 * Recognise transient service-availability errors that justify failing over
 * to the fallback model.
 */
function isServiceUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /(503|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|temporarily.unavailable|service.unavailable)/i.test(
    msg,
  )
}

// ── Schemas ────────────────────────────────────────────────────────────────
// IMPORTANT: `reasons` uses `.min(0)` at the schema level. We enforce at
// least one reason in post-processing so the LLM's JSON output never trips
// server-side schema validation (the root cause of past hard 400 errors).
const RuleResultSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()).max(8),
  flags: z
    .array(
      z.object({
        severity: z.enum(["info", "warn", "fail"]),
        message: z.string(),
      }),
    )
    .max(8),
})

export type RuleResult = z.infer<typeof RuleResultSchema>

const SummarySchema = z.object({
  summary: z.string(),
  topics: z.array(z.string()).max(8),
  predictive_flags: z.array(z.string()).max(6),
})

export type SummaryResult = z.infer<typeof SummarySchema>

export interface RunRuleOutput extends RuleResult {
  rule_id: string
  rule_name: string
  threshold: number
  weight: number
  latency_ms: number
  model: string
  raw: unknown
}

// ── Timeout + retry helpers ────────────────────────────────────────────────

/**
 * Race a promise against a hard timeout. Returns the original promise's
 * result, or throws an AbortError-like Error if the timeout fires first.
 *
 * We wire the abortSignal through the AI SDK so the underlying fetch is
 * aborted (not just the awaiting code) — this is what actually frees the
 * Lambda budget when Gemini is slow.
 */
function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fn(controller.signal)
    .catch((err) => {
      // Normalize to a recognisable timeout error.
      if (controller.signal.aborted) {
        throw new Error(`${label} timed out after ${ms}ms`)
      }
      throw err
    })
    .finally(() => clearTimeout(timer))
}

/**
 * Wrap a flaky network/LLM call with bounded exponential backoff. Permanent
 * failures (404 model-not-found, 401 invalid key, schema violations) are
 * surfaced on the first attempt so we don't waste the function budget.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      // Only retry transient errors. 4xx (except 429) are permanent.
      const transient =
        /(429|rate[- ]?limit|timeout|fetch failed|network|ECONN|ETIMEDOUT|UND_ERR|5\d\d|RESOURCE_EXHAUSTED|UNAVAILABLE)/i.test(
          msg,
        )
      if (!transient || i === attempts - 1) break
      // Backoff: ~1s, ~3s — keeps total retry overhead ≤ 5s.
      const backoff = 1_000 * Math.pow(3, i) + Math.floor(Math.random() * 250)
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM call failed")
}

// ── Prompt builder ─────────────────────────────────────────────────────────
/**
 * Build the per-rule user prompt. We substitute the canonical `{{TEXT}}`
 * placeholder if the manager wrote a self-contained prompt; otherwise we
 * append the document at the end.
 */
function buildRulePrompt(rule: ValidationRule, text: string, truncated: boolean): string {
  const template = rule.prompt_template ?? ""
  const hasPlaceholder = /\{\{\s*TEXT\s*\}\}/i.test(template)
  const filled = hasPlaceholder
    ? template.replace(/\{\{\s*TEXT\s*\}\}/gi, text)
    : [
      `Rule: ${rule.rule_name}`,
      rule.description ? `Description: ${rule.description}` : "",
      `Threshold: ${rule.threshold}`,
      `Instructions: ${template}`,
      "",
      "IMPORTANT: Evaluate the document ONLY against the criteria stated above in Instructions.",
      "Do NOT invent, assume, or check for requirements that are not explicitly mentioned.",
      "If the instructions ask to check for specific items (e.g. specific sections), only check for those exact items.",
      "",
      "Document text:",
      "---",
      text,
      "---",
    ]
      .filter(Boolean)
      .join("\n")

  return truncated
    ? `${filled}\n\nNote: the document was truncated for analysis; consider this when evaluating completeness.`
    : filled
}

// ── Rule runner ────────────────────────────────────────────────────────────

/** System prompt for substantive 0-100 quality rules. */
function scoredSystemPrompt(threshold: number): string {
  return [
    "You are a professional document quality auditor.",
    "Return ONLY a raw structured JSON object matching the schema. DO NOT wrap in ```json blocks.",
    "",
    "SCORING RUBRIC (0-100):",
    "90-100: Excellent — fully meets all stated criteria with no issues.",
    "70-89: Good — meets most criteria with minor gaps or formatting issues.",
    "40-69: Needs Improvement — partially meets criteria; significant gaps or quality issues.",
    "0-39: Poor — does not meet the stated criteria or is largely irrelevant.",
    "",
    `The pass threshold for this rule is ${threshold}. Set pass=true ONLY if the score >= ${threshold}.`,
    "",
    "CRITICAL INSTRUCTIONS:",
    "1. Evaluate ONLY against the criteria stated in the rule. Do NOT invent requirements.",
    "2. Be consistent: the same document evaluated against the same rule must always produce a similar score (within ±5 points).",
    "3. Anchor your score to the rubric above. A mediocre document should score 50-65, not 28 or 100.",
    "4. In reasons, cite specific evidence from the document. You MUST provide at least one reason.",
    "5. Do NOT hallucinate content. Only reference text actually present in the document.",
    "6. If the rule's own instructions explicitly say to skip when not applicable, follow that. Otherwise FAIL with a clear reason — never silently pass over criteria you cannot verify.",
  ].join("\n")
}

/** System prompt for binary yes/no checks (e.g. "contains the word X"). */
function binarySystemPrompt(): string {
  return [
    "You are a professional document compliance checker.",
    "Return ONLY a raw structured JSON object matching the schema. DO NOT wrap in ```json blocks.",
    "",
    "This is a BINARY check: the document either satisfies the criterion or it does not.",
    "There is no middle ground.",
    "",
    "OUTPUT RULES:",
    "1. Set pass=true if and only if the document satisfies the criterion exactly as stated.",
    "2. Set score=100 when pass=true. Set score=0 when pass=false. NO other values are valid.",
    "3. In reasons, cite the SPECIFIC evidence from the document that proves your verdict (quote a phrase or describe the location). Provide at least one reason.",
    "4. Do NOT invent additional requirements. Do NOT relax the criterion because the document is short, long, formal, or informal.",
    "5. Do NOT hallucinate content. Only reference text actually present in the document.",
    "6. Do NOT assign partial credit. If the criterion is 'contains the word hello', a document that contains 'hello' passes; a document that does not, fails — regardless of overall quality.",
  ].join("\n")
}

/**
 * Single-attempt rule call against a specific model. Wrapped by `runRule`
 * so we can swap models on transient failure without duplicating the prompt
 * construction.
 */
async function callRuleModel(
  text: string,
  rule: ValidationRule,
  modelId: string,
  opts: { truncated?: boolean; abortSignal?: AbortSignal },
): Promise<{ object: RuleResult }> {
  const isBinary = rule.rule_type === "binary"
  const prompt = buildRulePrompt(rule, text, Boolean(opts.truncated))

  return withTimeout(
    (signal) =>
      generateObject({
        model: provider.chat(modelId),
        temperature: 0,
        topP: 0.01,
        schema: RuleResultSchema,
        system: isBinary ? binarySystemPrompt() : scoredSystemPrompt(rule.threshold),
        prompt,
        abortSignal: anySignal(signal, opts.abortSignal),
      }),
    LLM_CALL_TIMEOUT_MS,
    `runRule(${rule.rule_name})`,
  ).then(({ object }) => ({ object }))
}

export async function runRule(
  text: string,
  rule: ValidationRule,
  opts: { truncated?: boolean; abortSignal?: AbortSignal } = {},
): Promise<RunRuleOutput> {
  const started = Date.now()

  let object: RuleResult
  let modelUsed = MODEL
  try {
    const result = await withRetry(() => callRuleModel(text, rule, MODEL, opts))
    object = result.object
  } catch (err) {
    // Safety-filter rejections are permanent — re-throw with a marker the
    // pipeline can detect and surface to the user as a needs_review reason.
    if (isSafetyFilterError(err)) {
      const safetyErr = new Error(
        `SAFETY_FILTER: AI safety filter blocked rule "${rule.rule_name}". Original: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      ;(safetyErr as any).code = "SAFETY_FILTER"
      throw safetyErr
    }

    // Transient service issues — try the fallback model once.
    if (FALLBACK_VALIDATION_MODEL && FALLBACK_VALIDATION_MODEL !== MODEL && isServiceUnavailable(err)) {
      console.warn(
        `[runRule] primary model ${MODEL} unavailable, retrying on fallback ${FALLBACK_VALIDATION_MODEL}`,
        err instanceof Error ? err.message : String(err),
      )
      const result = await callRuleModel(text, rule, FALLBACK_VALIDATION_MODEL, opts)
      object = result.object
      modelUsed = FALLBACK_VALIDATION_MODEL
    } else {
      throw err
    }
  }

  // Defence in depth: clamp binary outputs to 100/0 even if the LLM
  // ignored the instruction. This guarantees downstream scoring stays
  // consistent regardless of model quirks.
  if (rule.rule_type === "binary") {
    object = { ...object, score: object.pass ? 100 : 0 }
  }

  // Post-process: guarantee at least one reason so downstream code never
  // has to deal with an empty array. The schema allows 0 to avoid hard
  // server-side validation failures, but we fix it here.
  const reasons =
    object.reasons.length > 0
      ? object.reasons
      : [object.pass ? "Document meets the rule criteria." : "Document does not meet the rule criteria."]

  return {
    rule_id: rule.id,
    rule_name: rule.rule_name,
    threshold: rule.threshold,
    weight: rule.weight,
    latency_ms: Date.now() - started,
    model: modelUsed,
    raw: object,
    ...object,
    reasons,
  }
}

// ── Summariser ─────────────────────────────────────────────────────────────
export async function summarize(
  text: string,
  opts: { truncated?: boolean; abortSignal?: AbortSignal } = {},
): Promise<SummaryResult & { latency_ms: number }> {
  const started = Date.now()
  const promptParts = [
    "Produce a 3-5 sentence executive summary, the main topics covered, and predictive flags",
    "(risks, missing data, follow-ups). Document text follows.",
    opts.truncated ? "Note: the text was truncated for analysis." : "",
    "---",
    text,
    "---",
  ].filter(Boolean)

  const { object } = await withRetry(() =>
    withTimeout(
      (signal) =>
        generateObject({
          model: provider.chat(SUMMARY_MODEL),
          temperature: 0,
          topP: 0.01,
          schema: SummarySchema,
          system: [
            "You generate concise, professional executive summaries of documents.",
            "Return ONLY a raw JSON object matching the schema. DO NOT wrap in ```json blocks.",
            "Rules:",
            "- summary: Write exactly 3-5 sentences. Be factual and specific. Mention key topics and conclusions.",
            "- topics: List 3-6 main topics or themes found in the document.",
            "- predictive_flags: List 0-3 genuine risks or concerns ONLY if directly supported by the content. If the document is solid, return an empty array.",
            "- Do NOT invent or assume content that is not in the document.",
          ].join(" "),
          prompt: promptParts.join("\n"),
          abortSignal: anySignal(signal, opts.abortSignal),
        }),
      LLM_CALL_TIMEOUT_MS,
      "summarize",
    ),
  )

  return { ...object, latency_ms: Date.now() - started }
}

// ── Vision / OCR ───────────────────────────────────────────────────────────
/**
 * Use Gemini's native vision to extract text from an image. Much faster and
 * more reliable than Tesseract.js in serverless environments. We use the
 * full Flash model (not Lite) here for higher OCR fidelity on photos and
 * handwritten documents.
 */
export async function describeImage(
  buffer: Uint8Array,
  mimeType: string,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<{ text: string; notes?: string }> {
  const { text: rawText } = await withRetry(() =>
    withTimeout(
      (signal) =>
        generateText({
          model: provider.chat(VISION_MODEL),
          temperature: 0,
          topP: 0.01,
          system:
            "You are a vision OCR assistant. Transcribe ALL readable text from the image exactly as it appears. Preserve line breaks and formatting. If there are diagrams, tables, or signatures, describe them briefly after the transcribed text. Output plain text only, no JSON wrapping.",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract all readable text from this image. Preserve line breaks.",
                },
                { type: "image", image: buffer, mediaType: mimeType as `image/${string}` },
              ],
            },
          ],
          abortSignal: anySignal(signal, opts.abortSignal),
        }),
      // Vision is allowed slightly more time than text-only rules.
      LLM_CALL_TIMEOUT_MS + 10_000,
      "describeImage",
    ),
  )
  // Strip markdown artifacts the model sometimes wraps around plain text.
  const cleaned = rawText
    .replace(/^```[\s\S]*?\n/gm, "")
    .replace(/```\s*$/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .trim()
  return { text: cleaned, notes: undefined }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Combine multiple AbortSignals into one. Aborts when ANY of the inputs
 * abort. Used to layer the per-call timeout on top of any caller-provided
 * pipeline-level deadline.
 */
function anySignal(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const valid = signals.filter((s): s is AbortSignal => Boolean(s))
  if (valid.length === 1) return valid[0]
  // Native AbortSignal.any is available in Node 20+ and modern browsers.
  if (typeof (AbortSignal as unknown as { any?: typeof AbortSignal.any }).any === "function") {
    return (AbortSignal as unknown as { any: typeof AbortSignal.any }).any(valid)
  }
  // Fallback for older runtimes.
  const controller = new AbortController()
  for (const s of valid) {
    if (s.aborted) {
      controller.abort()
      break
    }
    s.addEventListener("abort", () => controller.abort(), { once: true })
  }
  return controller.signal
}
