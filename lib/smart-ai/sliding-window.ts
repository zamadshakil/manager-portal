/**
 * lib/smart-ai/sliding-window.ts
 * ==============================
 *
 * Token-aware conversation trimmer used by the fallback chat path.
 * Mirrors the logic in mcp-service/sliding-window.ts.
 *
 * When a conversation exceeds the token budget, older messages are
 * compressed into a summary while recent messages are kept verbatim.
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

export interface SlidingWindowOptions {
  /** Max total tokens allowed. Default: 12,000. */
  maxTokens?: number
  /** Minimum recent messages to keep verbatim. Default: 6. */
  recentKeepCount?: number
}

/**
 * Trims a conversation to fit within a token budget.
 * If no trimming is needed, returns the original array.
 */
export function applySlidingWindow(
  messages: SimpleMessage[],
  options: SlidingWindowOptions = {},
): SimpleMessage[] {
  const maxTokens = options.maxTokens ?? 12_000
  const recentKeepCount = options.recentKeepCount ?? 6

  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  if (totalTokens <= maxTokens) {
    return messages
  }

  const splitIndex = Math.max(0, messages.length - recentKeepCount)
  const oldMessages = messages.slice(0, splitIndex)
  const recentMessages = messages.slice(splitIndex)

  if (oldMessages.length === 0) {
    return recentMessages
  }

  const summary = summarizeOldMessages(oldMessages)

  const summaryMessage: SimpleMessage = {
    role: "system",
    content: summary,
  }

  return [summaryMessage, ...recentMessages]
}

function summarizeOldMessages(messages: SimpleMessage[]): string {
  const MAX_SUMMARY_CHARS = 2000
  const lines: string[] = [
    "[PRIOR CONVERSATION SUMMARY — older messages condensed to save tokens]",
    "",
  ]

  for (const msg of messages) {
    const content = msg.content.trim()
    if (!content) continue

    if (msg.role === "user") {
      const truncated = content.length > 200 ? content.slice(0, 200) + "…" : content
      lines.push(`User asked: ${truncated}`)
    } else if (msg.role === "assistant") {
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
