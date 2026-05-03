import { requireProfile } from "@/lib/auth"
import { listSubmissions } from "@/lib/data"
import { isMcpConfigured, isRagConfigured } from "@/lib/smart-ai/client"
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
 */
export default async function SmartAiPage() {
  const profile = await requireProfile()

  // Pull a small first page of recent submissions so the "Submissions
  // Review" tab has something to show before any client fetch.
  const { rows: recentSubmissions } = await listSubmissions(profile, { limit: 24 })

  const services = {
    mcp: isMcpConfigured(),
    rag: isRagConfigured(),
  }

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
    />
  )
}
