import { requireProfile } from "@/lib/auth"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProfileForm } from "@/components/dashboard/profile-form"
import { PasswordForm } from "@/components/dashboard/password-form"
import { roleLabel } from "@/lib/auth-shared"

export default async function SettingsPage() {
  const profile = await requireProfile()

  return (
    <>
      <PageHeader
        title="Settings"
        description={`Signed in as ${profile.email} (${roleLabel(profile.role)})`}
      />
      <div className="grid gap-6 lg:gap-8 lg:grid-cols-2">
        <ProfileForm profile={profile} />
        <PasswordForm mustReset={profile.must_reset} />
      </div>
    </>
  )
}
