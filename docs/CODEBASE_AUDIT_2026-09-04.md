# Manager Portal codebase audit

Audited: 2026-09-04  
Repository: `zamadshakil/manager-portal` (private)  
Baseline commit: `7384e938a70184838f0cc5570debf5b714c2f052`  
Audit branch: `preview/showcase-guest-access-20260904`

## Executive summary

The codebase is a substantial Next.js 16 application (520 tracked files, 328 TypeScript files, approximately 52,275 TypeScript lines, and 59 SQL migrations). Its role-aware dashboard, Supabase access model, security headers, and server-side authorization checks provide a credible foundation for a controlled showcase. It was not ready for a public preview at the audit baseline because production fallbacks exposed a predictable operations-console login, telemetry accepted untrusted identity data and captured sensitive request content, the production dependency graph contained 55 known advisories, and the former hosting/backend footprint was unavailable.

The audit branch fixes the directly exploitable findings, adds an isolated two-persona guest login, and updates the dependency graph to zero known production advisories. The application now builds and type-checks successfully. It is suitable for an isolated, disposable showcase after the preview database, guest accounts, and public hostname are provisioned. It should not be connected to real production data.

## Verification snapshot

| Check | Baseline | Audit branch |
| --- | --- | --- |
| Production build | Not verified | Pass (`next build`) |
| TypeScript | Pass | Pass (`tsc --noEmit`) |
| ESLint | Fail: 72 errors, 424 warnings | Pass: 0 errors, 408 warnings |
| Production dependency audit | 55 advisories (32 high) | 0 advisories |
| Automated tests | No test command or suite | Still absent |
| Main-branch protection | Disabled | Still disabled |
| Dependabot / code scanning / secret scanning | Disabled | Still disabled |

## Findings and disposition

### Critical — predictable operations-console credentials (fixed)

`lib/ops/auth.ts` fell back to `admin` / `admin123` and a predictable JWT signing secret whenever environment variables were absent, including production. The audit branch limits fallback credentials to local development and makes production authentication fail closed when any required secret is missing. Token signing cannot proceed without a configured secret, and credential comparison uses fixed-length SHA-256 digests with constant-time comparison.

### High — unauthenticated, client-asserted telemetry identity (fixed)

`/api/ops/ingest` accepted events without a verified Supabase or operations session and trusted client-provided user IDs, emails, and roles. The route now requires a verified server-side identity, derives profile information on the server, caps request size, restricts metadata to a small allowlist, and strips URL query strings and fragments.

### High — sensitive request/response capture (fixed)

The browser collector captured failed-request bodies, headers, response headers, and response previews. Those fields could contain passwords, tokens, personal data, and document content. The collector now records only method, sanitized URL, status, timing, and a bounded error message. The request proxy's direct service-role telemetry write was also removed.

### High — vulnerable production dependencies (fixed)

The baseline reported 55 production advisories, including a vulnerable Next.js release and a PDF.js path capable of executing JavaScript from a malicious PDF under affected configurations. Direct packages were upgraded, `officeparser` was updated, and safe transitive overrides were applied for `pdfjs-dist` and `uuid`. `pnpm audit --prod` now reports zero advisories. The overrides should be revisited when upstream packages adopt the patched versions directly.

### High — no automated test safety net (open)

There is no unit, integration, or end-to-end test command. Build, types, lint, and manual guest-flow checks are the only gates. Before production use, add authentication/authorization tests for every privileged API route, RLS integration tests, migration tests, and an end-to-end manager/member journey.

### Medium — branch and repository security automation disabled (open)

The main branch is unprotected and GitHub Dependabot alerts, code scanning, and secret scanning are disabled. Enable branch protection with required build/type/lint/test checks and at least one review; enable GitHub security features where the repository plan permits.

### Medium — lint debt masked as warnings (open)

Next.js 16.3 exposed React Compiler correctness findings in legacy components. Five compiler rules were downgraded to warnings so the existing codebase has a useful, non-failing lint gate. The remaining 408 warnings include effect-driven state updates, render-time impurity, ref access, explicit `any`, and unused values. Treat this as migration debt and burn it down by feature area rather than suppressing additional rule families.

### Medium — migrations can partially fail without failing startup (open)

The optional startup migration runner logs individual migration failures and continues serving. A fresh showcase should review every migration result before being shared. Production should use a dedicated migration job that stops deployment on failure and records an immutable migration log.

### Medium — shared guest accounts are mutable (mitigated for preview)

The requested guest manager and member are shared accounts. Visitors can change data visible to later visitors, and concurrent sessions are not attributable to individuals. The implementation keeps credentials server-only and gates one-click access behind `SHOWCASE_GUEST_LOGIN_ENABLED`. Deploy only against an isolated showcase database, exclude real integrations/data, rotate guest passwords after sharing, and periodically reset seed data.

## Showcase architecture and controls

- Use a separate Supabase project and a dedicated Vercel project; do not reuse the ApnaTask Supabase project or any former production database.
- Use `manager-preview.zamdevai.com` as a Cloudflare-managed preview hostname, leaving `system.zamdevai.com` untouched.
- Enable guest login only in the showcase project. Guest credentials are server-only environment variables and never rendered into the browser.
- Provision two profiles in one isolated team: guest manager and guest member, with representative tasks, submissions, announcements, and materials.
- Keep AI, email, object storage, and destructive operations unconfigured unless specifically needed for the demonstration.
- Verify public access without Vercel deployment protection and test both guest roles from a clean browser session.

## Production-readiness backlog

1. Add a CI workflow for install, audit, type-check, lint, tests, and build.
2. Add API authorization and Supabase RLS integration tests before changing any access policy.
3. Move migrations to a fail-fast deployment job and test a full empty-database migration in CI.
4. Resolve React Compiler warnings and restore the five rules to errors.
5. Enable protected branches, dependency alerts, secret scanning, and code scanning.
6. Replace shared guest accounts with expiring demo sessions or reset the showcase database on a schedule.
7. Perform a separate data-retention/privacy review before enabling operations telemetry for real users.

## Commands used for final verification

```text
pnpm install --frozen-lockfile=false
pnpm audit --prod
pnpm exec tsc --noEmit
pnpm lint
node --check scripts/provision-showcase-guests.mjs
pnpm build
```
