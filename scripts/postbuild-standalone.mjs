#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Postbuild: prepare the Next.js standalone output for deployment.
//
// `output: "standalone"` only emits a minimal node server + tracked deps. It
// does NOT include the `public/` directory or the client `.next/static`
// chunks — those need to be copied alongside the standalone server before it
// can serve the app.
//
// Previously this copy was done as part of the Railway `startCommand`, which
// meant it ran on EVERY container restart and added latency to cold starts.
// Worse, if the copy step ever failed mid-flight on a transient I/O blip,
// the container would crash-loop without any clear error.
//
// Doing it once here at build time is cheaper, deterministic, and means the
// runtime container only needs to invoke `node server.js`.
// ---------------------------------------------------------------------------

import { rm, cp, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

const root = process.cwd()
const standaloneDir = path.join(root, ".next", "standalone")

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function safeCopy(src, dest, label) {
  if (!(await exists(src))) {
    console.warn(`[postbuild] skipping ${label}: source ${src} not found`)
    return
  }
  // Remove first so re-runs don't merge stale files.
  if (existsSync(dest)) await rm(dest, { recursive: true, force: true })
  await cp(src, dest, { recursive: true })
  console.log(`[postbuild] copied ${label} → ${path.relative(root, dest)}`)
}

async function main() {
  if (!(await exists(standaloneDir))) {
    console.error(
      `[postbuild] ${standaloneDir} not found. Did 'next build' run with output: "standalone"?`,
    )
    process.exit(1)
  }

  await safeCopy(
    path.join(root, "public"),
    path.join(standaloneDir, "public"),
    "public/",
  )
  await safeCopy(
    path.join(root, ".next", "static"),
    path.join(standaloneDir, ".next", "static"),
    ".next/static/",
  )
  await safeCopy(
    path.join(root, "supabase", "migrations"),
    path.join(standaloneDir, "supabase", "migrations"),
    "supabase/migrations/",
  )
  await safeCopy(
    path.join(root, "scripts"),
    path.join(standaloneDir, "scripts"),
    "scripts/",
  )

  console.log("[postbuild] standalone bundle ready")
}

main().catch((err) => {
  console.error("[postbuild] failed:", err)
  process.exit(1)
})
