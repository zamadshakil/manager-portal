import { loginAction } from "./action"

interface Props {
  searchParams: Promise<{ error?: string; from?: string }>
}

export default async function OpsLoginPage({ searchParams }: Props) {
  const params = await searchParams
  const hasError = params.error === "invalid"
  const isUnconfigured = params.error === "unconfigured"

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-orange-500/10 mb-4">
            <svg
              className="w-6 h-6 text-orange-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white">Ops Console</h1>
          <p className="text-sm text-zinc-500 mt-1">Restricted access — authorized personnel only</p>
        </div>

        <form action={loginAction} className="space-y-4">
          {hasError && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
              Invalid credentials. Try again.
            </div>
          )}

          {isUnconfigured && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-300">
              Ops access is disabled until secure credentials are configured.
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Username
            </label>
            <input
              type="text"
              name="username"
              autoComplete="username"
              required
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 transition-colors"
              placeholder="ops_admin"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Password
            </label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 transition-colors"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-orange-500 hover:bg-orange-600 active:bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  )
}
