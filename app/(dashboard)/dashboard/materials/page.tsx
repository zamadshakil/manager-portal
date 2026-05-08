import { requireProfile } from "@/lib/auth"
import { listMaterials } from "@/lib/data"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/dashboard/page-header"
import { Materials } from "@/components/dashboard/materials"
import { MaterialUploader } from "@/components/dashboard/material-uploader"
import { BulkExportDialog } from "@/components/dashboard/bulk-export-dialog"

export default async function MaterialsPage() {
  const profile = await requireProfile()
  const materials = await listMaterials(profile, 200)
  const canUpload = profile.role === "main_admin" || profile.role === "manager"
  
  const supabase = await createClient()
  const { data: teams } = await supabase.from("teams").select("id, name").order("name")

  return (
    <>
      <PageHeader
        title="Materials"
        description="Reference documents, templates, and shared resources."
        action={
          canUpload ? (
            <BulkExportDialog
              type="materials"
              teams={teams ?? []}
              role={profile.role as "main_admin" | "manager"}
              currentTeamId={profile.team_id}
            />
          ) : null
        }
      />
      <div className="grid gap-6 lg:gap-8 lg:grid-cols-[1fr_360px]">
        <Materials rows={materials} canDelete={canUpload} />
        {canUpload ? <MaterialUploader role={profile.role} teams={teams ?? []} currentTeamId={profile.team_id} /> : null}
      </div>
    </>
  )
}
