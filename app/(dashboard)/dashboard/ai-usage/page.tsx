import { requireRole } from "@/lib/auth"
import { listAiCreditLimits, getSystemUsageTrend, getSystemTransactionLedger } from "@/app/actions/ai-credits"
import { AiUsageShell } from "@/components/dashboard/ai-usage/ai-usage-shell"

export const metadata = {
  title: "Main Admin Executive Dashboard · Hierarchia",
  description:
    "Centralized real-time audit trail of all AI credit activities across the platform.",
}

export const dynamic = "force-dynamic"

export default async function AiUsagePage() {
  // Strictly main_admin only — redirects all other roles to /dashboard
  const profile = await requireRole(["main_admin"])

  const [creditLimits, usageTrend, ledger] = await Promise.all([
    listAiCreditLimits(),
    getSystemUsageTrend(30),
    getSystemTransactionLedger(30),
  ])

  return (
    <AiUsageShell
      creditLimits={creditLimits}
      usageTrend={usageTrend}
      ledger={ledger}
      adminProfile={{
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        role: profile.role,
      }}
    />
  )
}
