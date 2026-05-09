"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { sendPasswordResetEmail } from "@/lib/email"
import { authLimiter } from "@/lib/redis"
import { getConfiguredSiteUrl } from "@/lib/site-url"

export async function requestPasswordReset(email: string) {
  // Rate-limit by normalised email to deter enumeration and credential-stuffing
  const { success: allowed } = await authLimiter().limit(`forgot:${email.toLowerCase()}`)
  if (!allowed) {
    // Return the same success shape to avoid timing/content oracle
    return { success: true }
  }

  // C-3: Never derive the site URL from request headers — always use the
  // pinned canonical origin. Falls back to localhost only in development so
  // the dev flow keeps working without a NEXT_PUBLIC_SITE_URL set.
  const siteUrl = getConfiguredSiteUrl()

  if (!siteUrl) {
    console.error("[auth] NEXT_PUBLIC_SITE_URL is not set — cannot generate a safe reset link.")
    // H-3: Still return success to avoid leaking whether the email exists
    return { success: true }
  }

  try {
    const supabase = createAdminClient()
    
    // We generate a recovery link using the admin API so we can handle the email sending ourselves
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: `${siteUrl}/auth/update-password`,
      }
    })

    // H-3: Do NOT surface whether the email is known or not — always return
    // success to the client. Errors are logged server-side only.
    if (error || !data?.properties?.action_link) {
      console.error("[auth] Error generating recovery link (may be unknown email):", error?.message ?? "no action_link")
      return { success: true }
    }

    let resetLink = data.properties.action_link
    
    try {
      const url = new URL(resetLink)
      const token = url.searchParams.get("token")
      const type = url.searchParams.get("type")
      
      if (token && type === "recovery") {
        resetLink = `${siteUrl}/auth/update-password?token_hash=${token}&type=recovery`
      }
    } catch (e) {
      console.error("[auth] Failed to parse action link:", e)
    }

    const emailSent = await sendPasswordResetEmail(email, resetLink)

    if (!emailSent) {
      console.error("[auth] Failed to send reset email for:", email)
    }

    // H-3: Always return success regardless of email-send outcome
    return { success: true }
  } catch (error) {
    console.error("[auth] Exception requesting password reset:", error)
    return { success: true }
  }
}
