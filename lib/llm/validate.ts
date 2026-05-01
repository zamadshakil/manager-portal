import "server-only"
import { generateObject, generateText } from "ai"
import { google } from "@ai-sdk/google"
import { z } from "zod"
import type { ValidationRule } from "@/lib/types"

// ── Model configuration ────────────────────────────────────────────────────
// Gemini Flash Lite: fast, cheap, excellent JSON-schema & vision support.
// Override via env vars for A/B testing or model upgrades.
const MODEL = process.env.GEMINI_VALIDATION_MODEL || "gemini-3.1-flash-lite-preview"
const SUMMARY_MODEL = process.env.GEMINI_SUMMARY_MODEL || "gemini-3.1-flash-lite-preview"
const VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-3.1-flash-lite-preview"

// Bumped whenever the system prompt or schema changes so we can compare
// historical runs in `validation_runs.prompt_version`.
export const PROMPT_VERSION = "v4"

// ── Schemas ────────────────────────────────────────────────────────────────
// IMPORTANT: `reasons` uses `.min(0)` at the schema level. We enforce at
// least one reason in post-processing so the LLM's JSON output never trips
// server-side schema validation (the root cause of Groq's hard 400 errors).
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

// ── Retry logic ────────────────────────────────────────────────────────────
/**
 * Wrap a flaky network/LLM call with bounded exponential backoff.
 * Handles transient 429s, 5xx, and network errors.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const transient =
        err instanceof Error &&
        /(429|rate limit|timeout|fetch failed|ECONN|5\d\d|RESOURCE_EXHAUSTED)/i.test(err.message)
      if (!transient || i === attempts - 1) break
      // Backoff: ~2s, ~5s, ~12s — gives Gemini quota time to reset.
      const backoff = 2000 * Math.pow(2.5, i) + Math.floor(Math.random() * 500)
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
export async function runRule(
  text: string,
  rule: ValidationRule,
  opts: { truncated?: boolean } = {},
): Promise<RunRuleOutput> {
  const started = Date.now()
  const prompt = buildRulePrompt(rule, text, Boolean(opts.truncated))

  const { object } = await withRetry(() =>
    generateObject({
      model: google(MODEL),
      temperature: 0,
      schema: RuleResultSchema,
      system: [
        "You are a strict but fair document validator.",
        "Return ONLY structured JSON matching the schema.",
        "Score is 0-100 where 100 is fully compliant.",
        `Pass=true only if score >= ${rule.threshold}.`,
        "CRITICAL RULES:",
        "1. Evaluate ONLY what the rule instructions explicitly ask for. Do NOT invent or assume additional requirements.",
        "2. If the document is a different type than what the rule expects (e.g. a technical spec checked against academic formatting), score based only on what the rule asks, not what the document 'should' have.",
        "3. If the rule criteria are not applicable to this document type, set pass=true, score=100, and explain it is not applicable.",
        "4. Be specific in `reasons`; cite short excerpts from the document where possible. YOU MUST PROVIDE AT LEAST ONE REASON, EVEN IF SCORE IS 100.",
        "5. Do NOT hallucinate content that is not in the document.",
      ].join(" "),
      prompt,
    }),
  )

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
    model: MODEL,
    raw: object,
    ...object,
    reasons,
  }
}

// ── Summariser ─────────────────────────────────────────────────────────────
export async function summarize(
  text: string,
  opts: { truncated?: boolean } = {},
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
    generateObject({
      model: google(SUMMARY_MODEL),
      temperature: 0,
      schema: SummarySchema,
      system: [
        "You generate concise executive summaries of business documents. Return JSON only matching the schema.",
        "Only describe what is actually in the document. Do NOT invent or assume content that is not present.",
        "For predictive_flags, only flag genuine risks that are directly supported by the document content.",
      ].join(" "),
      prompt: promptParts.join("\n"),
    }),
  )

  return { ...object, latency_ms: Date.now() - started }
}

// ── Vision / OCR ───────────────────────────────────────────────────────────
/**
 * Use Gemini's native vision to extract text from an image. Much faster and
 * more reliable than Tesseract.js in serverless environments.
 */
export async function describeImage(
  buffer: Uint8Array,
  mimeType: string,
): Promise<{ text: string; notes?: string }> {
  const { text: rawText } = await withRetry(() =>
    generateText({
      model: google(VISION_MODEL),
      temperature: 0,
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
    }),
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
