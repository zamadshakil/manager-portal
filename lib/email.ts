import { getCanonicalSiteUrl } from "@/lib/site-url"

/**
 * Brevo email integration using native fetch
 */

// M-4: Defensive HTML escaper for any value interpolated into the email body.
// Even though all current call sites pass admin-controlled data, escaping at
// the boundary prevents a future regression where a user-supplied string
// (e.g. full_name from sign-up) lands in an email body and renders as markup
// for the recipient — including admins reading their own copy.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export interface WelcomeEmailProps {
  email: string
  fullName: string
  role: string
}

export async function sendWelcomeEmail({ email, fullName, role }: WelcomeEmailProps) {
  const apiKey = process.env.BREVO_API_KEY
  const senderEmail = process.env.BREVO_SENDER_EMAIL
  const senderName = process.env.BREVO_SENDER_NAME || "AI Manager Portal"
  const siteUrl = getCanonicalSiteUrl()
  const companyAddress = process.env.COMPANY_ADDRESS || "Johar Town, Lahore"

  if (!apiKey || !senderEmail) {
    console.warn("[email] BREVO_API_KEY or BREVO_SENDER_EMAIL is missing. Skipping email dispatch.")
    return false
  }

  const roleText =
    role === "main_admin"
      ? "As a Main Admin, you have full control over the platform, team management, and organization settings."
      : role === "manager"
      ? "As a Manager, you can create tasks, manage team members, and define AI validation rules."
      : "As a Member, you can view, complete, and submit tasks assigned to your team."

  // M-4: Escape every interpolated value that could carry user-controlled
  // characters. senderName / siteUrl / roleText are operator-controlled but
  // we escape them too for defense-in-depth.
  const safeSenderName = escapeHtml(senderName)
  const safeFullName = escapeHtml(fullName)
  const safeEmail = escapeHtml(email)
  const safeRoleText = escapeHtml(roleText)
  const safeSiteUrl = encodeURI(siteUrl)
  const safeAddress = escapeHtml(companyAddress)
  const loginUrl = `${safeSiteUrl}/auth/login`

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
    <tr>
      <td align="center" style="padding:40px 20px;background-color:#f3f4f6;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:600px;width:100%;">
          <tr>
            <td style="background-color:#111827;padding:28px 32px;text-align:center;border-radius:8px 8px 0 0;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;letter-spacing:-0.3px;">${safeSenderName}</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#ffffff;padding:36px 32px 32px;">
              <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111827;font-family:Arial,Helvetica,sans-serif;">Hi ${safeFullName},</h1>
              <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#4b5563;font-family:Arial,Helvetica,sans-serif;">Your account on <strong style="color:#111827;">${safeSenderName}</strong> has been created. Welcome aboard!</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#4b5563;font-family:Arial,Helvetica,sans-serif;">${safeRoleText}</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 8px;font-size:14px;color:#4b5563;font-family:Arial,Helvetica,sans-serif;"><strong style="color:#111827;">Login email:</strong>&nbsp;${safeEmail}</p>
                    <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7280;font-family:Arial,Helvetica,sans-serif;">Your temporary password has been shared with you separately via a secure channel. You will be required to change it on first login.</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 6px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
                <a href="${loginUrl}" style="color:#2563eb;font-size:16px;font-weight:700;text-decoration:underline;font-family:Arial,Helvetica,sans-serif;">Log in to your account &#8594;</a>
              </p>
              <p style="margin:0 0 28px;text-align:center;font-size:12px;color:#9ca3af;word-break:break-all;font-family:Arial,Helvetica,sans-serif;">${loginUrl}</p>
              <p style="margin:0;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;">If you have questions, reach out to your administrator.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;border-radius:0 0 8px 8px;">
              <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;font-family:Arial,Helvetica,sans-serif;">&copy; ${new Date().getFullYear()} ${safeSenderName}. All rights reserved.</p>
              <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;font-family:Arial,Helvetica,sans-serif;">${safeAddress}</p>
              <p style="margin:0;font-size:11px;color:#d1d5db;font-family:Arial,Helvetica,sans-serif;">This is a transactional email sent because an administrator created your account.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const textContent = `Welcome to ${senderName}

Hi ${fullName},

Your account on ${senderName} has been created. Welcome aboard!

${roleText}

Login email: ${email}
Your temporary password has been shared with you separately via a secure channel. You will be required to change it on first login.

Log in here: ${siteUrl}/auth/login

If you have questions, reach out to your administrator.

---
${senderName}
${companyAddress}
This is a transactional email.`

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        "accept": "application/json",
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        replyTo: { email: senderEmail, name: senderName },
        to: [{ email, name: fullName }],
        subject: `Your ${senderName} account is ready`,
        htmlContent,
        textContent,
        headers: {
          "List-Unsubscribe": `<mailto:${senderEmail}>`,
          "X-Priority": "3",
          "Precedence": "bulk",
        },
      }),
    })

    if (!res.ok) {
      const errorData = await res.text()
      console.error("[email] Failed to send email via Brevo:", errorData)
      return false
    }

    return true
  } catch (err) {
    console.error("[email] Exception sending email:", err)
    return false
  }
}

export interface EmailChangeVerificationProps {
  /** The NEW email address — verification mail goes here. */
  newEmail: string
  /** Display name of the user whose email is being changed. */
  fullName: string
  /** Previous email of record (shown in the body for trust signals). */
  oldEmail: string
  /** Absolute URL with the one-time token the user must click. */
  verifyLink: string
  /** ISO string for when the token expires (rendered for the user). */
  expiresAt: string
}

/**
 * Sends a verification email to the NEW email address whenever a Main Admin
 * initiates an email change for another user. The auth email is only swapped
 * after the user clicks this link — that's the whole point of the flow.
 */
export async function sendEmailChangeVerification({
  newEmail,
  fullName,
  oldEmail,
  verifyLink,
  expiresAt,
}: EmailChangeVerificationProps) {
  const apiKey = process.env.BREVO_API_KEY
  const senderEmail = process.env.BREVO_SENDER_EMAIL
  const senderName = process.env.BREVO_SENDER_NAME || "AI Manager Portal"
  const companyAddress = process.env.COMPANY_ADDRESS || "Johar Town, Lahore"

  if (!apiKey || !senderEmail) {
    console.warn("[email] BREVO_API_KEY or BREVO_SENDER_EMAIL is missing. Skipping email-change verification dispatch.")
    return false
  }

  const safeSenderName = escapeHtml(senderName)
  const safeFullName = escapeHtml(fullName)
  const safeNewEmail = escapeHtml(newEmail)
  const safeOldEmail = escapeHtml(oldEmail)
  const safeVerifyLink = encodeURI(verifyLink)
  // HTML href attributes require & to be &amp; — without this, strict email
  // clients (Outlook, Apple Mail) may truncate the query string at the first &
  // and deliver a broken confirmation link.
  const safeVerifyLinkHtml = safeVerifyLink.replace(/&/g, '&amp;')
  const safeAddress = escapeHtml(companyAddress)
  const safeExpires = escapeHtml(
    new Date(expiresAt).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  )

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
    <tr>
      <td align="center" style="padding:40px 20px;background-color:#f3f4f6;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:600px;width:100%;">
          <tr>
            <td style="background-color:#111827;padding:28px 32px;text-align:center;border-radius:8px 8px 0 0;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;letter-spacing:-0.3px;">${safeSenderName}</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#ffffff;padding:36px 32px 32px;">
              <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111827;font-family:Arial,Helvetica,sans-serif;">Hi ${safeFullName},</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#4b5563;font-family:Arial,Helvetica,sans-serif;">An administrator on <strong style="color:#111827;">${safeSenderName}</strong> requested to change the email address on your account. Confirm the change by clicking the link below.</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 8px;font-size:14px;color:#4b5563;font-family:Arial,Helvetica,sans-serif;"><strong style="color:#6b7280;font-weight:500;">Previous email:</strong>&nbsp;<span style="color:#111827;font-family:'Courier New',Courier,monospace;font-weight:600;">${safeOldEmail}</span></p>
                    <p style="margin:0;font-size:14px;color:#4b5563;font-family:Arial,Helvetica,sans-serif;"><strong style="color:#6b7280;font-weight:500;">New email:</strong>&nbsp;<span style="color:#111827;font-family:'Courier New',Courier,monospace;font-weight:600;">${safeNewEmail}</span></p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 6px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
                <a href="${safeVerifyLinkHtml}" style="color:#2563eb;font-size:16px;font-weight:700;text-decoration:underline;font-family:Arial,Helvetica,sans-serif;">Confirm email change &#8594;</a>
              </p>
              <p style="margin:0 0 24px;text-align:center;font-size:12px;color:#9ca3af;word-break:break-all;font-family:Arial,Helvetica,sans-serif;">${safeVerifyLink}</p>
              <!-- Note: plain-text display uses the unescaped URL intentionally -->
              <p style="margin:0 0 10px;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;">This link expires on <strong style="color:#111827;">${safeExpires}</strong>. Until confirmed, your account will continue to use <strong style="color:#111827;">${safeOldEmail}</strong> for sign-in.</p>
              <p style="margin:0;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;">If you did not expect this change, ignore this email or contact your administrator immediately.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;border-radius:0 0 8px 8px;">
              <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;font-family:Arial,Helvetica,sans-serif;">&copy; ${new Date().getFullYear()} ${safeSenderName}. All rights reserved.</p>
              <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;font-family:Arial,Helvetica,sans-serif;">${safeAddress}</p>
              <p style="margin:0;font-size:11px;color:#d1d5db;font-family:Arial,Helvetica,sans-serif;">This is a transactional security email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const textContent = `Email Change Confirmation \u2014 ${senderName}

Hi ${fullName},

An administrator on ${senderName} requested to change the email on your account.

Previous email: ${oldEmail}
New email: ${newEmail}

To confirm this change, visit:
${verifyLink}

This link expires on ${new Date(expiresAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.

Until confirmed, your account will continue to use ${oldEmail} for sign-in.

If you did not expect this, ignore this email or contact your administrator immediately.

---
${senderName}
${companyAddress}
This is a transactional security email.`

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        "accept": "application/json",
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        replyTo: { email: senderEmail, name: senderName },
        to: [{ email: newEmail, name: fullName }],
        subject: `Confirm your new email \u2014 ${senderName}`,
        htmlContent,
        textContent,
        headers: {
          "List-Unsubscribe": `<mailto:${senderEmail}>`,
          "X-Priority": "3",
          "Precedence": "bulk",
        },
      }),
    })

    if (!res.ok) {
      const errorData = await res.text()
      console.error("[email] Failed to send email-change verification via Brevo:", errorData)
      return false
    }

    return true
  } catch (err) {
    console.error("[email] Exception sending email-change verification:", err)
    return false
  }
}

export interface EmailChangeAlertProps {
  /** The CURRENT (old) email address — alert mail goes here. */
  oldEmail: string
  /** The NEW requested email address (informational only). */
  newEmail: string
  /** Display name of the user. */
  fullName: string
  /** ISO string when the pending token expires. */
  expiresAt: string
}

/**
 * Sends a heads-up to the CURRENT email address whenever an admin initiates
 * an email change. The recipient does not need to act — the actual swap only
 * happens after the new address is confirmed. This is a pure security notice.
 */
export async function sendEmailChangeAlert({
  oldEmail,
  newEmail,
  fullName,
  expiresAt,
}: EmailChangeAlertProps): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY
  const senderEmail = process.env.BREVO_SENDER_EMAIL
  const senderName = process.env.BREVO_SENDER_NAME || "AI Manager Portal"
  const companyAddress = process.env.COMPANY_ADDRESS || "Johar Town, Lahore"

  if (!apiKey || !senderEmail) return false

  const safeSenderName = escapeHtml(senderName)
  const safeFullName = escapeHtml(fullName)
  const safeNewEmail = escapeHtml(newEmail)
  const safeAddress = escapeHtml(companyAddress)
  const safeExpires = escapeHtml(
    new Date(expiresAt).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  )

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
    <tr>
      <td align="center" style="padding:40px 20px;background-color:#f3f4f6;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:600px;width:100%;">
          <tr>
            <td style="background-color:#92400e;padding:28px 32px;text-align:center;border-radius:8px 8px 0 0;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">&#9888; Security Notice</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#ffffff;padding:36px 32px 32px;">
              <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111827;font-family:Arial,Helvetica,sans-serif;">Hi ${safeFullName},</h1>
              <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#4b5563;font-family:Arial,Helvetica,sans-serif;">An administrator on <strong style="color:#111827;">${safeSenderName}</strong> has initiated an email address change for your account.</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background-color:#fef3c7;border:1px solid #f59e0b;border-radius:6px;margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 8px;font-size:14px;color:#4b5563;font-family:Arial,Helvetica,sans-serif;"><strong style="color:#78350f;">Requested new email:</strong>&nbsp;<span style="color:#111827;font-family:'Courier New',Courier,monospace;font-weight:600;">${safeNewEmail}</span></p>
                    <p style="margin:0;font-size:13px;color:#92400e;font-family:Arial,Helvetica,sans-serif;">A verification link has been sent to the new address. <strong>The change only takes effect after it is confirmed.</strong></p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 10px;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;">This pending change expires on <strong style="color:#111827;">${safeExpires}</strong>. Until confirmed, your account will continue to use this email address for sign-in.</p>
              <p style="margin:0;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;">If you did not expect this change, contact your administrator immediately.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;border-radius:0 0 8px 8px;">
              <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;font-family:Arial,Helvetica,sans-serif;">&copy; ${new Date().getFullYear()} ${safeSenderName}. All rights reserved.</p>
              <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;font-family:Arial,Helvetica,sans-serif;">${safeAddress}</p>
              <p style="margin:0;font-size:11px;color:#d1d5db;font-family:Arial,Helvetica,sans-serif;">This is a transactional security email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const textContent = `Security Notice \u2014 ${senderName}

Hi ${fullName},

An administrator on ${senderName} has initiated an email address change for your account.

Requested new email: ${newEmail}

A verification link was sent to the new address. The change only takes effect after it is confirmed.

This pending change expires on ${new Date(expiresAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.

Until confirmed, your account continues to use this address for sign-in.

If you did not expect this, contact your administrator immediately.

---
${senderName}
${companyAddress}
This is a transactional security email.`

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        "accept": "application/json",
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        replyTo: { email: senderEmail, name: senderName },
        to: [{ email: oldEmail, name: fullName }],
        subject: `Security notice: email change requested \u2014 ${senderName}`,
        htmlContent,
        textContent,
        headers: {
          "X-Priority": "1",
          "Importance": "high",
        },
      }),
    })
    if (!res.ok) {
      console.error("[email] Failed to send email-change alert to old address:", await res.text())
      return false
    }
    return true
  } catch (err) {
    console.error("[email] Exception sending email-change alert:", err)
    return false
  }
}

export async function sendPasswordResetEmail(email: string, resetLink: string) {
  const apiKey = process.env.BREVO_API_KEY
  const senderEmail = process.env.BREVO_SENDER_EMAIL
  const senderName = process.env.BREVO_SENDER_NAME || "AI Manager Portal"
  const companyAddress = process.env.COMPANY_ADDRESS || "Johar Town, Lahore"

  if (!apiKey || !senderEmail) {
    console.warn("[email] BREVO_API_KEY or BREVO_SENDER_EMAIL is missing. Skipping email dispatch.")
    return false
  }

  const safeSenderName = escapeHtml(senderName)
  const safeResetLink = encodeURI(resetLink)
  const safeAddress = escapeHtml(companyAddress)

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
    <tr>
      <td align="center" style="padding:40px 20px;background-color:#f3f4f6;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:600px;width:100%;">
          <tr>
            <td style="background-color:#111827;padding:28px 32px;text-align:center;border-radius:8px 8px 0 0;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;letter-spacing:-0.3px;">${safeSenderName}</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#ffffff;padding:36px 32px 32px;">
              <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111827;font-family:Arial,Helvetica,sans-serif;">Password Reset Request</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#4b5563;font-family:Arial,Helvetica,sans-serif;">We received a request to reset the password for your <strong style="color:#111827;">${safeSenderName}</strong> account. Click the link below to choose a new password.</p>
              <p style="margin:0 0 6px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
                <a href="${safeResetLink}" style="color:#2563eb;font-size:16px;font-weight:700;text-decoration:underline;font-family:Arial,Helvetica,sans-serif;">Reset your password &#8594;</a>
              </p>
              <p style="margin:0 0 28px;text-align:center;font-size:12px;color:#9ca3af;word-break:break-all;font-family:Arial,Helvetica,sans-serif;">${safeResetLink}</p>
              <p style="margin:0;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email — your account remains secure.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;border-radius:0 0 8px 8px;">
              <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;font-family:Arial,Helvetica,sans-serif;">&copy; ${new Date().getFullYear()} ${safeSenderName}. All rights reserved.</p>
              <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;font-family:Arial,Helvetica,sans-serif;">${safeAddress}</p>
              <p style="margin:0;font-size:11px;color:#d1d5db;font-family:Arial,Helvetica,sans-serif;">This is a transactional security email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const textContent = `Password Reset \u2014 ${senderName}

We received a request to reset the password for your ${senderName} account.

To reset your password, visit:
${resetLink}

This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.

---
${senderName}
${companyAddress}
This is a transactional security email.`

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        "accept": "application/json",
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        replyTo: { email: senderEmail, name: senderName },
        to: [{ email }],
        subject: `Reset your ${senderName} password`,
        htmlContent,
        textContent,
        headers: {
          "List-Unsubscribe": `<mailto:${senderEmail}>`,
          "X-Priority": "3",
          "Precedence": "bulk",
        },
      }),
    })

    if (!res.ok) {
      const errorData = await res.text()
      console.error("[email] Failed to send password reset email via Brevo:", errorData)
      return false
    }

    return true
  } catch (err) {
    console.error("[email] Exception sending password reset email:", err)
    return false
  }
}
