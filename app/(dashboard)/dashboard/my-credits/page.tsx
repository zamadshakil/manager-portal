import { requireCapability, CAPABILITIES } from "@/lib/permissions"
import { getMyCredits, getMyUsageHistory } from "@/app/actions/ai-credits"
import { MyCreditsView } from "@/components/dashboard/ai-usage/my-credits-view"

export const metadata = {
  title: "My AI Credits · Hierarchia",
  description: "Your AI credit balance and personal usage history.",
}

export const dynamic = "force-dynamic"

export default async function MyCreditsPage() {
  await requireCapability(CAPABILITIES.AI_CREDITS_READ_SELF)

  const [credits, history] = await Promise.all([
    getMyCredits(),
    getMyUsageHistory(30),
  ])

  return <MyCreditsView credits={credits} history={history} />
}
