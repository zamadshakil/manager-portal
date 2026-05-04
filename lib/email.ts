/**
 * Brevo email integration using native fetch
 */

export interface WelcomeEmailProps {
  email: string
  fullName: string
  role: string
  password?: string
}

export async function sendWelcomeEmail({ email, fullName, role, password }: WelcomeEmailProps) {
  const apiKey = process.env.BREVO_API_KEY
  const senderEmail = process.env.BREVO_SENDER_EMAIL
  const senderName = process.env.BREVO_SENDER_NAME || "AI Manager Portal"
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://manager-portal-production-55a7.up.railway.app"

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

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: #f3f4f6;
            margin: 0;
            padding: 40px 20px;
            color: #1f2937;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            overflow: hidden;
          }
          .header {
            background-color: #111827;
            padding: 30px;
            text-align: center;
          }
          .header h1 {
            color: #ffffff;
            margin: 0;
            font-size: 24px;
            font-weight: 600;
          }
          .content {
            padding: 40px 30px;
          }
          .content h2 {
            margin-top: 0;
            font-size: 20px;
            color: #111827;
          }
          .content p {
            line-height: 1.6;
            margin-bottom: 20px;
            color: #4b5563;
          }
          .credentials {
            background-color: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 20px;
            margin: 30px 0;
          }
          .credentials p {
            margin: 8px 0;
            font-size: 15px;
          }
          .credentials strong {
            color: #111827;
          }
          .password {
            font-family: monospace;
            background-color: #e5e7eb;
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: 600;
          }
          .button-container {
            text-align: center;
            margin-top: 40px;
            margin-bottom: 20px;
          }
          .button {
            display: inline-block;
            background-color: #2563eb;
            color: #ffffff !important;
            text-decoration: none;
            padding: 14px 28px;
            border-radius: 6px;
            font-weight: 600;
            font-size: 16px;
            transition: background-color 0.2s;
          }
          .button:hover {
            background-color: #1d4ed8;
          }
          .footer {
            background-color: #f9fafb;
            padding: 20px;
            text-align: center;
            font-size: 13px;
            color: #6b7280;
            border-top: 1px solid #e5e7eb;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to ${senderName}</h1>
          </div>
          <div class="content">
            <h2>Hi ${fullName},</h2>
            <p>Your account has been successfully created. We're excited to have you on board!</p>
            
            <p>${roleText}</p>

            <div class="credentials">
              <p><strong>Login Email:</strong> ${email}</p>
              ${password ? `<p><strong>Temporary Password:</strong> <span class="password">${password}</span></p>` : ''}
              <p style="font-size: 13px; margin-top: 15px; color: #6b7280;">You will be required to change your password upon your first login.</p>
            </div>

            <div class="button-container">
              <a href="${siteUrl}/login" class="button">Log In to Your Account</a>
            </div>
            
            <p style="font-size: 14px;">If you have any questions, feel free to contact your administrator.</p>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} ${senderName}. All rights reserved.
          </div>
        </div>
      </body>
    </html>
  `

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        "accept": "application/json"
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email, name: fullName }],
        subject: `Welcome to ${senderName} - Your Account Details`,
        htmlContent
      })
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
