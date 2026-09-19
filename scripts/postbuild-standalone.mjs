#!/usr/bin/env node
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
  if (existsSync(dest)) await rm(dest, { recursive: true, force: true })
  await cp(src, dest, { recursive: true })
  console.log(`[postbuild] copied ${label} → ${path.relative(root, dest)}`)
}

async function main() {
  // On Vercel, Next.js serverless output is used so .next/standalone is not generated.
  if (!(await exists(standaloneDir))) {
    console.log("[postbuild] .next/standalone not found. Skipping standalone bundling (Vercel native build).")
    return
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
