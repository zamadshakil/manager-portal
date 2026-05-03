import { redirect } from "next/navigation"
import { getCurrentProfile } from "@/lib/auth"
import { getSupabaseEnv } from "@/lib/env"

export const dynamic = "force-dynamic"

export default async function RootPage() {
  // Defense-in-depth: if the Supabase env vars are missing (key rotation,
  // first deploy on Railway, broken `.env.local`, …) we don't want the
  // whole site to 500 with the unhelpful "URL and Key are required" stack.
  // Render the lightweight setup page instead and let the operator know
  // exactly what's missing. As soon as the vars come back this redirects
  // to /dashboard like normal.
  const env = getSupabaseEnv()
  if (!env.configured) {
    return (
      <main className="min-h-svh flex items-center justify-center bg-background px-4 py-10">
        <div className="max-w-lg space-y-4 rounded-lg border border-border/80 bg-card p-6 shadow-sm">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground text-balance">
              Supabase isn&apos;t configured yet
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The portal can&apos;t reach Supabase because one or more required
              environment variables are missing. After the migration to the
              Railway-hosted Supabase stack, point these at the Kong public URL
              with JWTs signed by the self-hosted GoTrue secret.
            </p>
          </div>
          <ul className="space-y-2 text-sm font-mono">
            {env.missing.map((key) => (
              <li
                key={key}
                className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive"
              >
                {key}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Set these on the <span className="font-mono">manager-portal</span>{" "}
            Railway service, then redeploy. The dashboard will load
            automatically once Supabase responds.
          </p>
        </div>
      </main>
    )
  }

  const profile = await getCurrentProfile()
  if (!profile) redirect("/auth/login")
  redirect("/dashboard")
}
