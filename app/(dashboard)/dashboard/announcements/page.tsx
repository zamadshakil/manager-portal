import { redirect } from "next/navigation"
import { requireProfile } from "@/lib/auth"
import { CAPABILITIES, getAccessContext } from "@/lib/permissions"
import { listAnnouncements } from "@/lib/data"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/dashboard/page-header"
import { Announcements } from "@/components/dashboard/announcements"
import { AnnouncementComposer } from "@/components/dashboard/announcement-composer"

export default async function AnnouncementsPage() {
  const profile = await requireProfile()
  const ctx = await getAccessContext(profile)
  const canReadAnnouncements = ctx.has(CAPABILITIES.ANNOUNCEMENTS_READ)
  const canCreateAnnouncements = ctx.has(CAPABILITIES.ANNOUNCEMENTS_CREATE)
  const canUpdateAnnouncements = ctx.has(CAPABILITIES.ANNOUNCEMENTS_UPDATE)
  const canDeleteAnnouncements = ctx.has(CAPABILITIES.ANNOUNCEMENTS_DELETE)

  if (!canReadAnnouncements && !canCreateAnnouncements && !canDeleteAnnouncements) {
    redirect("/dashboard")
  }

  const announcements = await listAnnouncements(profile)
  const canPost = canCreateAnnouncements && (profile.role === "main_admin" || !!profile.team_id)
  
  const teams = profile.role === "main_admin"
    ? (await createClient().then((supabase) => supabase.from("teams").select("id, name").order("name"))).data ?? []
    : []

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Team-wide updates, deadlines, and operational notices."
      />
      <div className="grid gap-6 lg:gap-8 lg:grid-cols-[1fr_360px]">
        <Announcements
          rows={announcements}
          canDelete={canDeleteAnnouncements}
          canDeleteGlobal={profile.role === "main_admin"}
          canEdit={canUpdateAnnouncements}
          canEditGlobal={profile.role === "main_admin"}
          currentTeamId={profile.team_id}
          showAll
        />
        {canPost ? <AnnouncementComposer canTargetGlobal={profile.role === "main_admin"} teams={teams} currentTeamId={profile.team_id} /> : null}
      </div>
    </>
  )
}
