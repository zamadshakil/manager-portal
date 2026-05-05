"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { sendPasswordResetEmail } from "@/lib/email"

export async function requestPasswordReset(email: string) {
  try {
    const supabase = createAdminClient()
    
    // We generate a recovery link using the admin API so we can handle the email sending ourselves
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/auth/update-password`,
      }
    })

    if (error) {
      console.error("[auth] Error generating recovery link:", error)
      return { success: false, error: "Failed to generate recovery link" }
    }

    if (!data.properties?.action_link) {
      console.error("[auth] No action link returned from Supabase")
      return { success: false, error: "Failed to generate recovery link" }
    }

    const resetLink = data.properties.action_link
    const emailSent = await sendPasswordResetEmail(email, resetLink)

    if (!emailSent) {
      return { success: false, error: "Failed to send reset email" }
    }

    return { success: true }
  } catch (error) {
    console.error("[auth] Exception requesting password reset:", error)
    return { success: false, error: "An unexpected error occurred" }
  }
}
