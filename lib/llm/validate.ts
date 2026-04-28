import "server-only"
import { generateObject } from "ai"
import { groq } from "@ai-sdk/groq"
import { z } from "zod"
import type { ValidationRule } from "@/lib/types"

const MODEL = process.env.GROQ_VALIDATION_MODEL || "llama-3.3-70b-versatile"
const SUMMARY_MODEL = process.env.GROQ_SUMMARY_MODEL || "llama-3.3-70b-versatile"

// Bumped whenever the system prompt or schema changes so we can compare
// historical runs in `validation_runs.prompt_version`.
export const PROMPT_VERSION = "v2"

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

/**
 * Wrap a flaky network/LLM call with bounded exponential backoff. Groq returns
 * 429s under load and occasional 5xx; this lets us absorb the noise without
 * flagging a submission as failed.
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
        /(429|rate limit|timeout|fetch failed|ECONN|5\d\d)/i.test(err.message)
      if (!transient || i === attempts - 1) break
      const backoff = 400 * Math.pow(2, i) + Math.floor(Math.random() * 250)
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM call failed")
}

/**
 * Build the per-rule user prompt. We substitute the canonical `{{TEXT}}`
 * placeholder if the manager wrote a self-contained prompt; otherwise we
 * append the document at the end. This fixes the prior bug where the literal
 * marker was sent to the model and the document was duplicated.
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

export async function runRule(
  text: string,
  rule: ValidationRule,
  opts: { truncated?: boolean } = {},
): Promise<RunRuleOutput> {
  const started = Date.now()
  const prompt = buildRulePrompt(rule, text, Boolean(opts.truncated))

  const { object } = await withRetry(() =>
    generateObject({
      model: groq(MODEL),
      schema: RuleResultSchema,
      system: [
        "You are a strict but fair document validator.",
        "Return ONLY structured JSON matching the schema.",
        "Score is 0-100 where 100 is fully compliant.",
        `Pass=true only if score >= ${rule.threshold}.`,
        "Be specific in `reasons`; cite excerpts where possible.",
      ].join(" "),
      prompt,
    }),
  )

  return {
    rule_id: rule.id,
    rule_name: rule.rule_name,
    threshold: rule.threshold,
    weight: rule.weight,
    latency_ms: Date.now() - started,
    model: MODEL,
    raw: object,
    ...object,
  }
}

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
      model: groq(SUMMARY_MODEL),
      schema: SummarySchema,
      system:
        "You generate concise executive summaries of business documents. Return JSON only matching the schema.",
      prompt: promptParts.join("\n"),
    }),
  )

  return { ...object, latency_ms: Date.now() - started }
}

/**
 * Vision fallback: when OCR returns very little text from an image upload, ask
 * a multimodal Groq model to describe the document directly. We surface the
 * description back to the caller as plain text the rest of the pipeline can
 * treat normally.
 */
const VisionSchema = z.object({
  text: z.string(),
  notes: z.string().optional(),
})

export async function describeImage(
  buffer: Uint8Array,
  mimeType: string,
): Promise<{ text: string; notes?: string }> {
  const VISION_MODEL = process.env.GROQ_VISION_MODEL || "llama-3.2-90b-vision-preview"
  const { object } = await withRetry(() =>
    generateObject({
      model: groq(VISION_MODEL),
      schema: VisionSchema,
      system:
        "You are a vision OCR assistant. Transcribe all readable text from the image and provide a brief description of any diagrams, tables, or signatures.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract all readable text from this image. Preserve line breaks. Return JSON only.",
            },
            { type: "image", image: buffer, mediaType: mimeType },
          ],
        },
      ],
    }),
  )
  return object
}
