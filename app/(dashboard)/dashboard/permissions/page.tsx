import { CAPABILITIES, requireCapability } from "@/lib/permissions"
import { listAllProfiles } from "@/lib/data"
import { loadPermissionAdminData } from "@/app/actions/permissions"
import { PageHeader } from "@/components/dashboard/page-header"
import { PermissionsMatrix } from "@/components/dashboard/permissions-matrix"

export const dynamic = "force-dynamic"

export default async function PermissionsPage() {
  const { profile } = await requireCapability(CAPABILITIES.USER_MANAGEMENT_PERMISSIONS)

  const [allProfiles, adminData] = await Promise.all([
    listAllProfiles(profile),
    loadPermissionAdminData(),
  ])

  if (!adminData.ok) {
    return (
      <>
        <PageHeader
          title="Access control"
          description="Manage per-user capability overrides."
        />
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-[13px] text-destructive">
          {adminData.error ?? "Could not load permission data."}
        </div>
      </>
    )
  }

  // Exclude the main admin(s) — their permissions are always all-allow and
  // cannot be overridden.
  const targets = allProfiles.filter((p) => p.role !== "main_admin")

  return (
    <>
      <PageHeader
        title="Access control"
        description="Grant or revoke module-level capabilities for managers and team members. Role defaults apply automatically; overrides only kick in when set."
      />
      <PermissionsMatrix
        users={targets}
        definitions={adminData.definitions ?? []}
        roleDefaults={adminData.defaults ?? []}
        overrides={adminData.overrides ?? []}
      />
    </>
  )
}
