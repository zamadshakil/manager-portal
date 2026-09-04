# Cloudflare showcase release runbook

## Deployment boundary

- Primary URL: https://showcase.zamdevai.com
- Alternate: https://hierarchia-showcase.zamadshakil.workers.dev
- Cloudflare account: 08a10f953d00eca77f380d234b62f550
- Worker: hierarchia-showcase
- Dedicated custom domain only. Existing `system.zamdevai.com` and `showcase.system.zamdevai.com` records remain untouched.
- Static Next export in `showcase-site/out`; only `/api/funnel/leads` invokes the intake handler. No full-portal API, Supabase connection, AI call, password or uploaded document is included.
- No paid plan enabled. Free-plan limits still apply; inspect actual account usage before expanding. Do not approve upgrades or trials implicitly.

## Build and deploy

Use Node 22+ and pnpm 9.15.4, install dependencies from the repository root, and authenticate Wrangler to the existing Cloudflare account. Read the branch's AGENTS.md before code changes.

```powershell
pnpm install --frozen-lockfile
pnpm audit --prod
pnpm test:funnel
pnpm lint
pnpm build
pnpm exec tsc --noEmit
pnpm showcase:build
pnpm exec tsc -p showcase-site/worker-tsconfig.json
pnpm exec wrangler deploy --config showcase-site/wrangler.jsonc --dry-run
pnpm showcase:deploy
```

The compatibility date is 2026-09-04 (UTC deployment date). Do not advance it without testing. The GitHub workflow runs quality checks but does not automatically deploy. The full-portal build is a regression gate, not the artifact sent to Cloudflare.

## Secrets and CRM

BREVO_API_KEY is installed through `wrangler secret put`; never put its value in wrangler.jsonc, a command argument, browser source, a document or Git. `.env.local` is gitignored and restricted to the current Windows user. It stores the owner's local management key. The generated Worker types contain only the secret's name and type.

`node scripts/configure-funnel.mjs` idempotently configures the dedicated lists, attributes and inactive templates using the local key. It does not enroll existing contacts or send messages. It reuses existing templates without replacing their copy; `email-sequences.json` supplies new templates only.

`node scripts/update-funnel-address.mjs` updates only the address line in the five known inactive templates, preserving their copy, sender, reply-to and unsubscribe placeholder. The address is read from the gitignored `.env.funnel.local` file and was applied to IDs 13 through 17. It does not activate templates or change the Brevo billing/company address.

For rotation, create a replacement in Brevo, update the protected local file, run `node scripts/upload-funnel-secret.mjs`, and verify intake. Revoke the old key only after the new key works. The key was created with the provider's one-year default expiry; confirm its exact date in Brevo and arrange renewal. This runbook does not create a renewal reminder.

## Verification and troubleshooting

`node scripts/verify-live-funnel.mjs` checks public pages and intake, creates a unique owned Gmail plus-address QA contact, reads back its scoped list/attributes, then deletes exactly that contact. It needs the local Brevo key. It sends no email. Run deliberately; it writes a disposable CRM record, not just HTTP reads.

The form allows only the explicitly configured primary and alternate origins. An origin check is not authentication and does not stop a determined bot. The Cloudflare native limiter is per location and IP, not a global exact quota; shared networks can hit it. Investigate repeated 429 responses before changing the limit.

On a 502, inspect Brevo key validity, list 17 and account limits. On a 503, check the Worker bindings and FUNNEL_FORMS_ENABLED. Never log the request body, email, key or raw provider response. The endpoint returns success only after Brevo accepts the write. Repeated submission updates scoped attributes on the same contact; no nurture enrollment or outbound email occurs.

Browser layout and click-through checks were not performed in this release. Manually test mobile/desktop navigation, both demo roles, calculator, checkbox accessibility, successful/error form states, mailbox replies and the booking process before a wider campaign.

## Pause and rollback

To stop intake while leaving the site available, set FUNNEL_FORMS_ENABLED to false in the Worker configuration and redeploy. The form will show a clear failure and provide the mailbox fallback; it will not falsely confirm a saved lead. Investigate before re-enabling.

For a bad release, use Cloudflare Workers > hierarchia-showcase > Deployments to roll back to the previous known-good version, then verify the primary URL and intake. Worker rollback does not undo Brevo contacts or DNS changes. Do not delete lists, contacts, DNS records or keys as a generic rollback.

For a clean reproducible redeploy, check out a known-good commit in a separate worktree, install the lockfile, build and deploy. Preserve the owner's current working changes. Keep the custom domain stable while repairing a release.

## Remaining production work

The original application's separate database, guest identities, full migrations and real manager/member E2E journey remain unprovisioned/unverified. Funnel unit tests do not prove portal authorization or RLS safety. Main-branch protection and repository security settings are unchanged. Dependabot configuration requires the normal default-branch integration before treating it as active.

Confirm data-retention practices and mailbox response ownership. The owner-supplied mailing address is now in the draft footers; sender verification and opt-in/unsubscribe tests remain required before email activation. Native nurture automation, calendar automation, visitor analytics, prospect research and LinkedIn scheduling are not configured.
