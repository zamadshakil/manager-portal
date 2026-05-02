import { requireProfile } from "@/lib/auth"
import { listAnnouncements } from "@/lib/data"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/dashboard/page-header"
import { Announcements } from "@/components/dashboard/announcements"
import { AnnouncementComposer } from "@/components/dashboard/announcement-composer"

export default async function AnnouncementsPage() {
  const profile = await requireProfile()
  const announcements = await listAnnouncements(profile)
  const canPost = profile.role === "main_admin" || profile.role === "manager"
  
  const supabase = await createClient()
  const { data: teams } = await supabase.from("teams").select("id, name").order("name")

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Team-wide updates, deadlines, and operational notices."
      />
      <div className="grid gap-6 lg:gap-8 lg:grid-cols-[1fr_360px]">
        <Announcements
          rows={announcements}
          canDelete={canPost}
          showAll
        />
        {canPost ? <AnnouncementComposer role={profile.role} teams={teams ?? []} currentTeamId={profile.team_id} /> : null}
      </div>
    </>
  )
}
