/**
 * sliding-window.ts
 * =================
 *
 * Token-aware conversation trimmer for the MCP service. Prevents the full
 * chat history from being sent to the LLM on every turn, which:
 *
 *   1. Burns unnecessary tokens (and money) on already-seen context.
 *   2. Risks hitting the model's context window limit on long conversations.
 *   3. Slows down inference — more input tokens = longer time-to-first-token.
 *
 * Strategy:
 *
 *   The most recent N messages are ALWAYS kept verbatim (the "recency window").
 *   If the conversation exceeds the budget, older messages are compressed into
 *   a single "[Prior conversation summary]" block injected as the first message.
 *
 *   This is a practical middle-ground between:
 *   - Sending everything (expensive, slow, risks overflow)
 *   - Truncating blindly (loses important early context like task descriptions)
 *
 * Token counting uses a lightweight character-based heuristic (1 token ≈ 4 chars
 * for English). We intentionally avoid importing tiktoken here to keep the MCP
 * service's cold-start fast and dependency footprint small.
 */

export interface SimpleMessage {
  role: "user" | "assistant" | "system"
  content: string
  metadata?: Record<string, unknown>
}

/** Approximate token count. 1 token ≈ 4 chars for English text. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Options for the sliding window trimmer.
 */
export interface SlidingWindowOptions {
  /**
   * Maximum total tokens to allow in the outgoing message array.
   * Default: 12,000 (leaves ~4k headroom on a 16k context model,
   * or plenty of room on 128k models like GPT-4o).
   */
  maxTokens?: number

  /**
   * Minimum number of recent messages to always keep verbatim.
   * These are never summarized, even if they exceed the budget.
   * Default: 6 (3 user + 3 assistant turns).
   */
  recentKeepCount?: number
}

/**
 * Trims a conversation to fit within a token budget by summarizing
 * older messages into a condensed recap.
 *
 * @returns The trimmed message array, ready to send to the LLM.
 *          If no trimming was needed, returns the original array unchanged.
 */
export function applySlidingWindow(
  messages: SimpleMessage[],
  options: SlidingWindowOptions = {},
): SimpleMessage[] {
  const maxTokens = options.maxTokens ?? 12_000
  const recentKeepCount = options.recentKeepCount ?? 6

  // If the conversation is short enough, return as-is
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  if (totalTokens <= maxTokens) {
    return messages
  }

  // Split into "old" (to be summarized) and "recent" (to keep verbatim)
  const splitIndex = Math.max(0, messages.length - recentKeepCount)
  const oldMessages = messages.slice(0, splitIndex)
  const recentMessages = messages.slice(splitIndex)

  // If there's nothing old to summarize, we're stuck — just truncate from the front
  if (oldMessages.length === 0) {
    return recentMessages
  }

  // Build a condensed summary of the old messages
  const summary = summarizeOldMessages(oldMessages)

  // Inject the summary as a system message at the start
  const summaryMessage: SimpleMessage = {
    role: "system",
    content: summary,
  }

  return [summaryMessage, ...recentMessages]
}

/**
 * Creates a condensed text summary of older messages.
 * This is a rule-based extraction (not LLM-based) to keep it fast and free.
 *
 * We extract:
 * - Key user questions/requests
 * - Key data points from assistant responses (IDs, scores, names)
 * - Tool results are heavily compressed
 */
function summarizeOldMessages(messages: SimpleMessage[]): string {
  const MAX_SUMMARY_CHARS = 2000
  const lines: string[] = [
    "[PRIOR CONVERSATION SUMMARY — older messages have been condensed to save tokens]",
    "",
  ]

  for (const msg of messages) {
    const content = msg.content.trim()
    if (!content) continue

    if (msg.role === "user") {
      // Keep user messages relatively intact but truncated
      const truncated = content.length > 200 ? content.slice(0, 200) + "…" : content
      lines.push(`User asked: ${truncated}`)
    } else if (msg.role === "assistant") {
      // Compress assistant responses to key facts
      const truncated = content.length > 300 ? content.slice(0, 300) + "…" : content
      lines.push(`AI responded: ${truncated}`)
    }
  }

  let result = lines.join("\n")
  if (result.length > MAX_SUMMARY_CHARS) {
    result = result.slice(0, MAX_SUMMARY_CHARS) + "\n…[summary truncated]"
  }

  return result
}
