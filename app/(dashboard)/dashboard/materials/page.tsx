import { requireProfile } from "@/lib/auth"
import { listMaterials } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { Materials } from "@/components/dashboard/materials"
import { MaterialUploader } from "@/components/dashboard/material-uploader"

export const dynamic = "force-dynamic"

export default async function MaterialsPage() {
  const profile = await requireProfile()
  const materials = await listMaterials(profile, 200)
  const canUpload = profile.role === "main_admin" || profile.role === "manager"

  return (
    <>
      <PageHeader
        title="Materials"
        description="Reference documents, templates, and shared resources."
      />
      <div className="grid gap-6 lg:gap-8 lg:grid-cols-[1fr_360px]">
        <Materials rows={materials} canDelete={canUpload} />
        {canUpload ? <MaterialUploader /> : null}
      </div>
    </>
  )
}
