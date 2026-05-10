/**
 * Next.js Instrumentation Hook (stable since Next.js 14).
 *
 * `register()` is called exactly once per server process start, before the
 * first request is handled.  We use it to run pending DB migrations so that
 * every Railway deploy automatically catches up the schema without any
 * manual SQL steps.
 *
 * Opt-in: set RUN_MIGRATIONS_ON_BOOT=true in Railway Variables for the
 * manager-portal service.  The env var is intentionally absent from local
 * .env.local to avoid accidentally running migrations against a dev DB.
 *
 * Only runs in the Node.js runtime (not the Edge runtime).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.RUN_MIGRATIONS_ON_BOOT !== "true") return

  const { runMigrations } = await import("./lib/db/run-migrations")
  await runMigrations()
}
