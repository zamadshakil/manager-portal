import { requireRole } from "@/lib/auth"
import { listAiCreditLimits, getSystemUsageTrend } from "@/app/actions/ai-credits"
import { AiUsageShell } from "@/components/dashboard/ai-usage/ai-usage-shell"

export const metadata = {
  title: "AI & Usage · Hierarchia",
  description:
    "Manage AI credit limits per user, track consumption history, and monitor system-wide AI usage across all teams.",
}

export default async function AiUsagePage() {
  // Strictly main_admin only — redirects all other roles to /dashboard
  const profile = await requireRole(["main_admin"])

  const [creditLimits, usageTrend] = await Promise.all([
    listAiCreditLimits(),
    getSystemUsageTrend(30),
  ])

  return (
    <AiUsageShell
      creditLimits={creditLimits}
      usageTrend={usageTrend}
      adminProfile={{
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        role: profile.role,
      }}
    />
  )
}
