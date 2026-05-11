import Link from "next/link"
import { CheckCircle2, XCircle, Mail } from "lucide-react"

import { Button } from "@/components/ui/button"
import { confirmEmailChange } from "@/app/actions/users"

interface PageProps {
  searchParams: Promise<{ uid?: string; token?: string }>
}

/**
 * Public landing page for the email-change verification link sent to a user's
 * NEW mailbox after a Main Admin initiates an email change. The page itself
 * is intentionally render-only — `confirmEmailChange` is the gatekeeper that
 * validates the token and performs the swap.
 *
 * The link is single-use: after a successful confirmation the token is
 * cleared from the profile, so any later visit will land on the "expired or
 * already used" branch.
 */
export default async function ConfirmEmailChangePage({ searchParams }: PageProps) {
  const params = await searchParams
  const uid = typeof params.uid === "string" ? params.uid : ""
  const token = typeof params.token === "string" ? params.token : ""

  let result: { ok: boolean; error?: string; newEmail?: string }

  if (!uid || !token) {
    result = { ok: false, error: "This confirmation link is missing required parameters." }
  } else {
    try {
      result = await confirmEmailChange(uid, token)
    } catch (err) {
      console.error("[confirm-email-change] unhandled error:", err)
      result = { ok: false, error: "An unexpected server error occurred. Please try again or contact your administrator." }
    }
  }

  return (
    <main className="min-h-svh bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        <header className="border-b border-border bg-muted/30 px-6 py-5">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                result.ok
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive"
              }`}
              aria-hidden="true"
            >
              {result.ok ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <XCircle className="h-5 w-5" />
              )}
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">
                {result.ok ? "Email confirmed" : "Could not confirm email"}
              </h1>
              <p className="text-xs text-muted-foreground font-medium">
                Email change verification
              </p>
            </div>
          </div>
        </header>

        <div className="p-6 space-y-4">
          {result.ok ? (
            <>
              <p className="text-[14px] leading-relaxed text-muted-foreground">
                Your account email has been successfully updated. From now on, please
                use the address below to sign in.
              </p>
              {result.newEmail ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                  <span className="text-[13px] font-mono font-semibold select-all break-all">
                    {result.newEmail}
                  </span>
                </div>
              ) : null}
              <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                If you are currently signed in on another device, you may need to sign in
                again with your new email.
              </p>
            </>
          ) : (
            <>
              <p className="text-[14px] leading-relaxed text-muted-foreground">
                {result.error ??
                  "We could not finalize this email change. The link may have expired, already been used, or no longer match a pending request."}
              </p>
              <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                Please contact your administrator and ask them to resend the verification.
              </p>
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-border bg-muted/30 px-6 py-4">
          {result.ok ? (
            /* POST to signout so the old JWT is cleared before re-login.
               If not signed in, signout is a no-op that still redirects to /auth/login. */
            <form action="/auth/signout" method="POST">
              <Button type="submit">Sign in with new email</Button>
            </form>
          ) : (
            <Button asChild>
              <Link href="/auth/login">Back to sign in</Link>
            </Button>
          )}
        </footer>
      </div>
    </main>
  )
}
