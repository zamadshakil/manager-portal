import { generateObject } from "ai"
import { groq } from "@ai-sdk/groq"
import { z } from "zod"
import type { ValidationRule } from "@/lib/types"

const MODEL = process.env.GROQ_VALIDATION_MODEL || "llama-3.3-70b-versatile"
const SUMMARY_MODEL = process.env.GROQ_SUMMARY_MODEL || "llama-3.3-70b-versatile"

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

export async function runRule(text: string, rule: ValidationRule): Promise<RunRuleOutput> {
  const started = Date.now()
  const { object } = await generateObject({
    model: groq(MODEL),
    schema: RuleResultSchema,
    system: [
      "You are a strict document validator.",
      "Return ONLY structured JSON matching the schema.",
      "Score is 0-100 where 100 is fully compliant.",
      "Pass=true only if score >= the supplied threshold.",
    ].join(" "),
    prompt: [
      `Rule: ${rule.rule_name}`,
      rule.description ? `Description: ${rule.description}` : "",
      `Threshold: ${rule.threshold}`,
      `Instructions: ${rule.prompt_template}`,
      "",
      "Document text:",
      "---",
      text,
      "---",
    ]
      .filter(Boolean)
      .join("\n"),
  })

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

export async function summarize(text: string): Promise<SummaryResult & { latency_ms: number }> {
  const started = Date.now()
  const { object } = await generateObject({
    model: groq(SUMMARY_MODEL),
    schema: SummarySchema,
    system:
      "You generate concise executive summaries of business documents. Return JSON only matching the schema.",
    prompt: [
      "Produce a 3-5 sentence executive summary, the main topics covered, and predictive flags",
      "(risks, missing data, follow-ups). Document text follows.",
      "---",
      text,
      "---",
    ].join("\n"),
  })

  return { ...object, latency_ms: Date.now() - started }
}
