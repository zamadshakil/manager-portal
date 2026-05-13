#!/usr/bin/env node
/**
 * configure-r2-cors.mjs
 *
 * One-time script: sets a CORS policy on the R2 bucket so browsers can PUT
 * files directly to R2 via pre-signed URLs (required for the pre-signed
 * upload flow in task-submission-form.tsx).
 *
 * Usage (from the project root):
 *   node scripts/configure-r2-cors.mjs
 *
 * Reads credentials from .env.local automatically.
 */

import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3"
import { createRequire } from "module"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { readFileSync } from "fs"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Parse .env.local manually (no dotenv dependency required).
function loadEnv(filePath) {
  try {
    const text = readFileSync(filePath, "utf8")
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eqIdx = trimmed.indexOf("=")
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let val = trimmed.slice(eqIdx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    // .env.local not present — rely on environment variables already set.
  }
}

loadEnv(join(__dirname, "..", ".env.local"))

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  NEXT_PUBLIC_APP_URL,
} = process.env

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error("❌  Missing R2 env vars. Ensure these are set in .env.local or your environment:")
  console.error("      R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME")
  process.exit(1)
}

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
})

// Allow PUT from any origin so both the production domain and any future
// custom domains work without re-running this script.
// The pre-signed URL itself is already scoped to a single key + 5-minute TTL,
// so a wildcard origin does not weaken the security posture.
const corsRule = {
  AllowedOrigins: ["*"],
  AllowedMethods: ["PUT"],
  AllowedHeaders: ["Content-Type"],
  MaxAgeSeconds: 3600,
}

console.log(`Configuring CORS on bucket "${R2_BUCKET_NAME}"…`)
console.log("  Origin : *")
console.log("  Methods: PUT")
console.log("  Headers: Content-Type")
console.log("")

await r2.send(
  new PutBucketCorsCommand({
    Bucket: R2_BUCKET_NAME,
    CORSConfiguration: { CORSRules: [corsRule] },
  }),
)

console.log("✅  Done. Browsers can now PUT files directly to R2.")
console.log("")
console.log("You only need to run this once per bucket.")
console.log("To verify, visit: Cloudflare Dashboard → R2 → " + R2_BUCKET_NAME + " → Settings → CORS")
