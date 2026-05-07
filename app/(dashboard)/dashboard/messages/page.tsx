import { requireProfile } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { MessagingLayout } from "@/components/dashboard/messaging/messaging-layout"
import type { Profile } from "@/lib/types"

export const metadata = { title: "Messages" }

export default async function MessagesPage() {
  const profile = await requireProfile()
  const admin = createAdminClient()

  // Fetch all org profiles for the contact picker (DM / group creation)
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, email, avatar_url, role")
    .neq("id", profile.id)
    .order("full_name", { ascending: true })

  return (
    <MessagingLayout
      currentUserId={profile.id}
      currentUserName={profile.full_name ?? profile.email}
      profiles={(profiles ?? []) as Profile[]}
    />
  )
}
