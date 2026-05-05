import { requireProfile } from "@/lib/auth"
import { listSubmissions } from "@/lib/data"
import { SmartAiShell } from "@/components/dashboard/smart-ai/smart-ai-shell"

export const metadata = {
  title: "Smart AI · Hierarchia",
  description:
    "Chat with your portal data, review submissions, and explore retrieval analytics powered by RAG over PostgreSQL + pgvector.",
}

/**
 * Smart AI hub.
 *
 * Server-renders the shell with role-scoped initial data and a service
 * health snapshot. The chat/analytics tabs hydrate via SWR + the AI SDK
 * `useChat` hook so the page paints instantly.
 *
 * Reads the `?thread=<uuid>` search param so reloading or sharing a URL
 * re-opens the exact conversation (like ChatGPT / Claude desktop).
 */
export default async function SmartAiPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const profile = await requireProfile()
  const resolvedParams = await searchParams

  // Extract thread ID from URL — supports ?thread=<uuid>
  const threadParam = resolvedParams.thread
  const initialThreadId =
    typeof threadParam === "string" && threadParam.length > 0
      ? threadParam
      : null

  // Pull a small first page of recent submissions so the "Submissions
  // Review" tab has something to show before any client fetch.
  const { rows: recentSubmissions } = await listSubmissions(profile, { limit: 24 })

  // Smart AI now runs entirely natively (chat, RAG, analytics) inside this
  // Next.js app. The shell still accepts a `services` prop for forward-
  // compatibility, but both flags are constant `true` post-decommission.
  const services = { mcp: true, rag: true }

  return (
    <SmartAiShell
      profile={{
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        role: profile.role,
        team_id: profile.team_id,
      }}
      submissions={recentSubmissions}
      services={services}
      initialThreadId={initialThreadId}
    />
  )
}
