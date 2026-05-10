import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { verifyToken } from "@/lib/ops/auth"
import { NavTabs } from "@/components/ops/nav-tabs"

async function opsLogout() {
  "use server"
  const jar = await cookies()
  jar.delete("ops_session")
  redirect("/ops/login")
}

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const xPathname = h.get("x-pathname") ?? ""
  const isLoginPage = xPathname === "/ops/login" || xPathname.startsWith("/ops/login?")

  if (!isLoginPage) {
    const jar = await cookies()
    const token = jar.get("ops_session")?.value
    if (!token || !verifyToken(token)) {
      redirect("/ops/login")
    }
  }

  if (isLoginPage) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-orange-500/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
              </div>
              <span className="font-semibold text-sm text-white">Ops Console</span>
            </div>
            <form action={opsLogout}>
              <button
                type="submit"
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2.5 sm:px-3 py-1.5 rounded-md hover:bg-zinc-800"
              >
                Sign out
              </button>
            </form>
          </div>
          <NavTabs />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {children}
      </main>
    </div>
  )
}
