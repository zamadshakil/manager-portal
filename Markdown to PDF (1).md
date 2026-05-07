

Security Audit Report — Security Audit Report — JobFlowAI/manager-portalJobFlowAI/manager-portal
Scope:Scope: Next.js 16 App Router + self-hosted Supabase (Kong/PostgREST/GoTrue) + Cloudflare R2 + Upstash Redis + OpenRouter/OpenAI + Brevo email. Method:Method: Manual static review of
all API routes, server actions, edge proxy, RLS policies, SQL migrations, auth flows, file/upload handlers, AI tool routing, RAG indexer/retriever, third-party integrations, and CSP/headers.
## 1. Critical Findings1. Critical Findings
C-1. Unauthenticated, destructive admin endpoint — C-1. Unauthenticated, destructive admin endpoint — GET /api/admin/fix-dbGET /api/admin/fix-db
Severity:Severity: Critical File:File: app/api/admin/fix-db/route.ts
The handler issues ALTER TABLE, CREATE OR REPLACE FUNCTION ... SECURITY DEFINER, ALTER PUBLICATION and NOTIFY pgrst, 'reload schema' against the live Postgres
via the direct pg pool. There is no There is no requireRolerequireRole, no shared-secret check, no IP allow-list — just , no shared-secret check, no IP allow-list — just if (!isDirectPgConfigured())if (!isDirectPgConfigured()).. Any unauthenticated visitor who knows the URL can:
Add/recreate auth.sessions and auth.users columns.
Replace public.increment_ai_usage (a SECURITY DEFINER function) — full SQL takeover vector.
Force a PostgREST schema reload (DoS against API throughput).
Indirectly modify behaviour of every other authenticated endpoint that calls increment_ai_usage.
Impact:Impact: Remote unauthenticated SQL execution as the database owner. Full data breach + tampering + DoS.
Non-intrusive mitigation plan:Non-intrusive mitigation plan:
- Block the route at the edge immediately.Block the route at the edge immediately. Add a Railway/Vercel rewrite or Cloudflare WAF rule:
## 2. Pattern: /api/admin/*
- Action: 404 for all source IPs not in the operator allow-list.
- Tighten via reverse-proxy auth.Tighten via reverse-proxy auth. If you front the deployment with Cloudflare, enable Cloudflare Access on /api/admin/* requiring SSO from the @yourdomain group.
- Rotate Rotate SUPABASE_DB_URLSUPABASE_DB_URL, , SUPABASE_SERVICE_ROLE_KEYSUPABASE_SERVICE_ROLE_KEY, and the GoTrue , and the GoTrue JWT_SECRETJWT_SECRET — assume they have been used by an attacker until proven otherwise (check
pg_stat_statements and Railway access logs for /api/admin/fix-db).
- Audit the Audit the public.increment_ai_usagepublic.increment_ai_usage body body in production using \df+ public.increment_ai_usage and compare with the migration source.
- Add a PostgreSQL role for the applicationAdd a PostgreSQL role for the application that does not own the schema and revoke ALTER, CREATE FUNCTION, and NOTIFY from it (REVOKE ALL ON SCHEMA public, auth
FROM app_runtime; then GRANT SELECT, INSERT, UPDATE, DELETE ON public.* TO app_runtime;). Switch SUPABASE_DB_URL to this least-privilege role.
- Open a tracking ticket to require requireRole(["main_admin"]) + CRON_SECRET header in code (not editable in this audit).
C-2. Cron endpoint C-2. Cron endpoint fails openfails openwhen when CRON_SECRETCRON_SECRETis unsetis unset
Severity:Severity: Critical File:File: app/api/cron/mark-missed/route.ts
const secret = process.env.CRON_SECRET;
if (secret) { ...check... }   // ← if no env var, no check
The route is then free to:
Mass-UPDATE task_assignments SET status='missed'.
Bulk-DELETE FROM announcements/materials WHERE expires_at < now() plus the matching R2 object deletion.
Crash the validation pipeline by flipping any in-flight submission to failed.
The proxy explicitly excludes /api/cron from auth in proxy.ts matcher.
Impact:Impact: Unauthenticated denial-of-data and integrity loss.
Non-intrusive mitigation plan:Non-intrusive mitigation plan:
- Set Set CRON_SECRETCRON_SECRET in every environment immediately in every environment immediately (Railway → Variables → Add CRON_SECRET=$(openssl rand -hex 32)).
- Re-deploy and verifyRe-deploy and verify with curl -i https://<host>/api/cron/mark-missed — must return 401.
- Restrict at the edgeRestrict at the edge to known cron origin IPs (Railway Cron uses Railway IPs, list available in Railway docs) or to Cloudflare scheduled-worker IPs.
- Add a WAF ruleAdd a WAF rule that blocks /api/cron/* when the Authorization header is absent.
- Enable Sentry/PostHog alertingEnable Sentry/PostHog alerting on cron.mark-missed.failures > 0 and on 200 with Authorization missing — flag both as security events.
C-3. Host-header injection in password-reset email linkC-3. Host-header injection in password-reset email link
Severity:Severity: Critical File:File: app/actions/auth.ts (requestPasswordReset)
const host = headersList.get("host") || "localhost:3000"
const protocol = host.includes("localhost") ? "http" : "https"
const dynamicSiteUrl = `${protocol}://${host}`
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || dynamicSiteUrl
When NEXT_PUBLIC_SITE_URL is empty (mentioned as common after Railway migration in the README), siteUrl is built from the request request HostHost header header. An attacker sending Host:
attacker.tld to the production endpoint causes Brevo to mail the victim a recovery URL pointing at https://attacker.tld/auth/update-password?
token_hash=...&type=recovery. The victim opens it, the token is captured, and the attacker uses it on the legitimate site to take the account over.
Impact:Impact: Full account takeover of any user whose email an attacker knows.

Non-intrusive mitigation plan:Non-intrusive mitigation plan:
- Pin Pin NEXT_PUBLIC_SITE_URLNEXT_PUBLIC_SITE_URL in Railway → Variables to the canonical hostname (https://manager.yourdomain.com). Re-deploy. Verify by triggering a forgot-password flow
from a non-production hostname and confirming the email still uses the canonical URL.
- Add a Cloudflare WAF "Host header allow-list" ruleAdd a Cloudflare WAF "Host header allow-list" rule: (http.host ne "manager.yourdomain.com") → block.
- Configure Brevo "verified click domains"Configure Brevo "verified click domains" so that password-reset emails sent with a non-allow-listed host fail to render.
- Rotate any tokens issued during the gapRotate any tokens issued during the gap — invalidate via auth.users recovery_sent_at reset, and require all users to log in again (Supabase Studio → Auth → Refresh
sessions).
- Monitor Brevo logsMonitor Brevo logs for outbound emails whose body contains a host other than the canonical one for 30 days.
C-4. Open redirect via C-4. Open redirect via nextnextparameter on multiple auth surfacesparameter on multiple auth surfaces
Severity:Severity: High → Critical (phishing pivot) Files:Files: components/auth/login-form.tsx, app/auth/callback/route.ts, lib/supabase/proxy.ts
LoginForm: const next = params.get("next") || "/dashboard"; router.replace(next) — next/navigation's router.replace accepts absolute URLs and
external schemes.
auth/callback: ${origin}${next} — next=//evil.com/x yields https://manager.app//evil.com/x which browsers normalise to https://evil.com/x.
The proxy itself sets ?next=<originalPath> on its 302, so a crafted phishing link https://manager.app/anything?next=https://evil.com/login will round-trip the user
through legitimate login then onto the attacker's clone.
Impact:Impact: Credential phishing using a trusted hostname in the address bar.
Non-intrusive mitigation plan:Non-intrusive mitigation plan:
- Cloudflare/Vercel edge ruleCloudflare/Vercel edge rule to strip next query params whose value is notnot a path beginning with /dashboard or /auth/. Pseudocode:
- if request.url ~ /[?&]next=/ and not (next ~ ^/[a-z0-9_/-]+$): set next=/dashboard.
- Add Add Referrer-Policy: no-referrerReferrer-Policy: no-referrer for /auth/* (you currently set strict-origin-when-cross-origin) so leaked tokens never accompany an external-redirect Referer.
- Enable Cloudflare Bot Management / phishing-pattern WAFEnable Cloudflare Bot Management / phishing-pattern WAF on /auth/login to reject requests with off-host next values.
- Add a CSP Add a CSP form-action 'self'form-action 'self' directive in next.config.mjs headers (operator can do via Cloudflare Transform Rules without code change). This blocks form posts from
being redirected outside the site.
- Track the issueTrack the issue for an in-code allow-list: if (!next.startsWith("/")) next = "/dashboard".
- High-Severity Findings2. High-Severity Findings
H-1. CSP allows H-1. CSP allows 'unsafe-inline''unsafe-inline'and and 'unsafe-eval''unsafe-eval'in in script-srcscript-src
Severity:Severity: High File:File: next.config.mjs
script-src 'self' 'unsafe-inline' 'unsafe-eval'
Combined with the open-redirect and any future stored-XSS sink, this CSP effectively does not prevent XSS. The chart component (components/ui/chart.tsx:83) uses
dangerouslySetInnerHTML for theme variables — a low-but-real DOM-XSS sink if user-supplied colours ever flow in.
Mitigation plan (no code changes):Mitigation plan (no code changes):
- Replace with a nonce-based CSPReplace with a nonce-based CSP at the edge (Cloudflare Transform Rule or Vercel header override): script-src 'self' 'nonce-<per-request>' 'strict-dynamic';
object-src 'none'; base-uri 'self'.
- Add require-trusted-types-for 'script' for browsers that support Trusted Types.
- Tighten connect-src from https://*.up.railway.app and https://*.r2.dev to specific subdomains; wildcards under up.railway.app mean any other Railway tenant
could be dialled by injected JS.
- Add frame-ancestors 'none' (already present), and sandbox allow-scripts allow-same-origin on /api/download/* responses via an edge rule, to neutralise
PDF/HTML XSS from R2.
H-2. Stored XSS path through R2-hosted downloadsH-2. Stored XSS path through R2-hosted downloads
Severity:Severity: High Files:Files: app/api/download/[id]/route.ts, app/api/smart-ai/upload/route.ts, app/actions/submissions.ts
The download proxy sends back the Content-Type value that was stored in the DB at upload time — and that value originated from the client-suppliedclient-supplied file.type. The check if
(file.type && !ACCEPTED.has(file.type)) in submissions.ts skips when file.type is empty, so a multipart upload without a Content-Type header is accepted and later
replayed as application/octet-stream. With Content-Disposition: inline, the file is rendered inside manager.app origin context (top-level navigation, not iframe). Combined
with the lax CSP (H-1), this is a working stored-XSS vector for any authenticated user.
Mitigation plan:Mitigation plan:
- Force download disposition at the edge.Force download disposition at the edge. Add a Cloudflare Worker / Vercel rewrite for /api/download/* that sets Content-Disposition: attachment (overrides inline)
and strips any Content-Type: text/html / image/svg+xml / application/xhtml+xml, replacing with application/octet-stream.
- Add Add X-Content-Type-Options: nosniffX-Content-Type-Options: nosniff is already set globally — confirm it propagates on this route specifically (Next streams responses; check that the proxy doesn't drop
it).
- Configure the R2 bucket's CORS + Object LambdaConfigure the R2 bucket's CORS + Object Lambda so it never serves text/html regardless of the original content type.
- Block Block Content-Type: text/html|image/svg\+xml|application/xhtml\+xmlContent-Type: text/html|image/svg\+xml|application/xhtml\+xml on POST /api/smart-ai/upload and on multipart submissions at the WAF (Cloudflare
Custom Rules → "Block when http.request.headers.content_type matches HTML").
- Long-termLong-term: ask the team to whitelist the MIME unconditionally on the server, and to strip file.type and re-detect via a magic-byte sniff (e.g., file-type lib). Track as a
separate ticket — outside this non-intrusive scope.
H-3. H-3. requestPasswordResetrequestPasswordResetreveals account existencereveals account existence

Severity:Severity: High File:File: app/actions/auth.ts
supabase.auth.admin.generateLink returns an error when the email is unknown; the action surfaces { success: false, error: "Failed to generate recovery link" } to
the client, while a real email returns { success: true }. An attacker can enumerate the entire user base via the unauthenticated /auth/forgot-password form.
Mitigation plan:Mitigation plan:
- Edge response normalisation.Edge response normalisation. In Cloudflare Transform Rules, rewrite any 200 OK JSON response from the action that contains "Failed to generate recovery link" to {
"success": true } — making positive/negative responses indistinguishable.
- Rate-limit Rate-limit /auth/forgot-password/auth/forgot-password to 3 / hour / IP to 3 / hour / IP at the WAF.
- Wire the existing Wire the existing authLimiter()authLimiter() (defined in lib/redis.ts but currently unused) — track in a code change ticket; until then enforce purely at WAF.
- Disable detailed error loggingDisable detailed error logging for this route in production by lowering the log level for [auth] Error generating recovery link. Otherwise attackers with logs read can still
enumerate.
- MonitorMonitor for >50 forgot-password attempts/hour — alert via Sentry.
H-4. H-4. authLimiterauthLimiter, , chatLimiterchatLimiter, and , and uploadLimiteruploadLimiterare no-ops when Redis is unconfiguredare no-ops when Redis is unconfigured
Severity:Severity: High File:File: lib/redis.ts
When UPSTASH_REDIS_REST_URL/TOKEN are missing, getRedis() returns null and every limiter falls back to mockLimiter that always returns always returns success: truesuccess: true. There is no log
alarm. The login page does not even invoke authLimiter (grep shows it's defined but unreferenced in app/), so credential-stuffing is unmetered.
Mitigation plan:Mitigation plan:
- Set Set UPSTASH_REDIS_REST_URLUPSTASH_REDIS_REST_URL +  + UPSTASH_REDIS_REST_TOKENUPSTASH_REDIS_REST_TOKEN in production. Verify via /api/smart-ai/health (the diagnostic endpoint).
- Add a deployment guardAdd a deployment guard: a Vercel/Railway pre-deploy check that fails if either var is empty.
- Enforce login throttling at Cloudflare Rate LimitingEnforce login throttling at Cloudflare Rate Limiting (5 POSTs / minute / IP / username pair to /api/* and to Supabase auth endpoints /auth/v1/token). This compensates for
the missing in-app limiter on /auth/login.
- Add a Sentry alertAdd a Sentry alert on [redis] init returned null — the warning is logged but not surfaced.
- Front Supabase GoTrueFront Supabase GoTrue with the same Cloudflare rule to brute-force the upstream password endpoint as well.
H-5. Cross-tenant chat-message deletion in H-5. Cross-tenant chat-message deletion in DELETE /api/smart-ai/threadsDELETE /api/smart-ai/threads
Severity:Severity: High File:File: app/api/smart-ai/threads/route.ts
await supabase.from("chat_messages").delete().eq("thread_id", threadId)   // no user_id filter!
const { error } = await supabase.from("chat_threads").delete()
.eq("id", threadId).eq("user_id", profile.id)                            // ownership only on threads
Because getSupabase() returns a service-role client when the env var is set (which is the norm), an authenticated user supplying another user's threadId will succeed in deleting their
chat_messages rows even though the thread row itself fails to delete. Result: silent destruction of victim's chat history.
Mitigation plan:Mitigation plan:
- Apply Postgres-level RLS for Apply Postgres-level RLS for chat_messages.deletechat_messages.delete to scope by EXISTS(SELECT 1 FROM chat_threads t WHERE t.id = chat_messages.thread_id AND t.user_id =
auth.uid()). RLS is bypassed by service role, so additionally:
- Stop using service role for thread management.Stop using service role for thread management. Override SUPABASE_SERVICE_ROLE_KEY to empty for this route by deploying a separate Vercel/Railway env scoped to the API
service; force the route to fall back to user JWT (createBrowserClient() path).
- Add an audit triggerAdd an audit trigger on chat_messages that logs OLD.thread_id + auth.uid() on every delete — surface anomalies (deletions where the deleter ≠ thread owner).
- WAF ruleWAF rule: block DELETE /api/smart-ai/threads requests where the supplied id query parameter belongs to a different user_id (impossible at WAF without DB context —
instead, rate-limit DELETE to 5/min/user and alert on >20/day).
H-6. H-6. POST /api/smart-ai/bootstrapPOST /api/smart-ai/bootstrapruns schema migrations as any signed-in userruns schema migrations as any signed-in user
Severity:Severity: High File:File: app/api/smart-ai/bootstrap/route.ts
The handler explicitly notes "Auth: any signed-in user (the bootstrap is idempotent and exposes no data — restrict further if your environment requires admin-only)". A logged-in member
can POST {force: true} repeatedly, triggering DDL execution via pgQuery (ensureRagSchema) — DoS and possible privilege escalation if a future migration body trusts caller
context.
Mitigation plan:Mitigation plan:
- WAF ruleWAF rule: restrict POST /api/smart-ai/bootstrap to operator IPs.
- Add Add Cloudflare AccessCloudflare Access policy policy requiring SSO + admin group.
- Set a feature-flag env varSet a feature-flag env var (RAG_BOOTSTRAP_DISABLED=true) so the handler short-circuits in production. (The route reads isDirectPgConfigured() only — set it to false in prod
by unsetting SUPABASE_DB_URL if direct-pg isn't actually used.)
- Rate-limit via CloudflareRate-limit via Cloudflare to 1 / minute / IP and alert on spikes.
H-7. CSRF on POST H-7. CSRF on POST /auth/signout/auth/signout(and other custom route handlers)(and other custom route handlers)
Severity:Severity: High File:File: app/auth/signout/route.ts
Next.js Server Actions enforce CSRF via Origin/Referer comparison automatically. Plain Route Handlers (route.ts) do notnot. POST /auth/signout accepts cross-site form posts → an
attacker page can force-log-out users on visit, then race them to login (session-fixation pivots). The same concern applies to any future route.ts that mutates state and trusts cookies.
Mitigation plan:Mitigation plan:
- Cloudflare Transform/Custom RuleCloudflare Transform/Custom Rule: reject POSTs to /auth/* whose Origin or Referer doesn't match the canonical hostname.
- SameSite=LaxSameSite=Lax (or  (or StrictStrict) on the Supabase session cookie.) on the Supabase session cookie. Configure GoTrue (GOTRUE_COOKIE_SAMESITE=lax, GOTRUE_COOKIE_SECURE=true) — done at Railway, no code
change.
- Add a custom Add a custom Sec-Fetch-Site: same-originSec-Fetch-Site: same-origin allow-list rule allow-list rule at the WAF for /auth/* POSTs.

- Document that all new sensitive route handlers must add Document that all new sensitive route handlers must add getOrigin()getOrigin() checks checks — until then, rely on the WAF.
H-8. Service-role bypass of RLS for normal user readsH-8. Service-role bypass of RLS for normal user reads
Severity:Severity: High Files:Files: app/api/smart-ai/threads/route.ts, app/api/smart-ai/threads/[id]/messages/route.ts, app/api/smart-ai/chat/route.ts
These routes always prefer the service-role client, then manually re-apply ownership filters (.eq("user_id", profile.id)). Any future regression in those filters becomes a full data-
leak (across all tenants). The getUserUsageHistory, getSystemTransactionLedger, and getSystemTotalMessages flows similarly use admin client and rely solely on
requireRole(["main_admin"]).
Mitigation plan:Mitigation plan:
- Reduce service-role blast radius.Reduce service-role blast radius. Create a second Supabase JWT signing key (service_role_chat) limited via a Postgres role with read-only access to chat_threads,
chat_messages, ai_credit_limits, ai_usage_log. Substitute that in SUPABASE_SERVICE_ROLE_KEY for routes that don't need DDL.
- Set up Set up pgauditpgaudit on the service-role connection user and ship audit logs to a SIEM (e.g., S3 + Athena via Vector). Alert on chat_messages reads where user_id != actor.
- Force RLS for service-role on selected tablesForce RLS for service-role on selected tables via ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY; plus matching policies. Service role then has no escape.
- Network-segment PostgresNetwork-segment Postgres so only the manager-portal Railway service can dial it; an exposed .railway.internal host has bitten others.
H-9. Verbose error responses leak DB internalsH-9. Verbose error responses leak DB internals
Severity:Severity: High Files:Files: app/api/smart-ai/chat/route.ts, app/api/smart-ai/upload/route.ts, app/api/admin/fix-db/route.ts, multiple actions
error: error.message, details: dbError?.message, and the queryDatabase tool's "Schema mismatch" branch surface raw PostgREST/PG error strings (column names, RLS
hints, function names). These directly aid attackers mapping the schema and finding RLS gaps.
Mitigation plan:Mitigation plan:
- Deploy a Cloudflare Workers response-rewriterDeploy a Cloudflare Workers response-rewriter for /api/* that, for any 4xx/5xx JSON, replaces error/details/hint with "An error occurred" and copies the original to
a Sentry breadcrumb.
- Set Set NODE_ENV=productionNODE_ENV=production rigorously (the chat route's verbose console.log is gated on it).
- Enable Sentry's "scrub URLs/headers/body" rulesEnable Sentry's "scrub URLs/headers/body" rules to redact bearer tokens and PII before transit.
- Disable PostgREST hint surfacingDisable PostgREST hint surfacing — set PGRST_OPENAPI_MODE=disabled and PGRST_DB_AGGREGATES_ENABLED=false on the Kong/PostgREST container.
H-10. Welcome email contains plaintext temporary passwordH-10. Welcome email contains plaintext temporary password
Severity:Severity: High Files:Files: app/actions/users.ts, lib/email.ts
provisionUser accepts a password chosen by the admin and ships it via Brevo over SMTP. Brevo retains email bodies (Sent Messages) for 30 days by default, putting passwords in
their breach blast radius and in the user's inbox indefinitely.
Mitigation plan:Mitigation plan:
- Switch Brevo template variables to "do-not-store"Switch Brevo template variables to "do-not-store" — under Brevo dashboard → Account → Privacy, disable "Save sent email body". Verify via API.
- Configure Brevo retention to 0 daysConfigure Brevo retention to 0 days for transactional senders in senderEmail.
- Educate operatorsEducate operators: only ever provision users with the auto-generated 16-char password (the form already has a "Generate strong" button) and instruct admins to send the
password through a separate channel (1Password Send, Bitwarden Send) — strip the password block from the Brevo template (template-side change, not code).
- Add Brevo account-level alertsAdd Brevo account-level alerts for any email containing the regex <span class="password">.
- Medium-Severity Findings3. Medium-Severity Findings
##File / IssueFile / IssueDescriptionDescriptionImpactImpactNon-intrusive MitigationNon-intrusive Mitigation
## M-M-
## 11
app/auth/callback/route.ts
${origin}${next} accepts //evil.com (protocol-relative
open redirect, also covered in C-4).
PhishingSame WAF rule as C-4.
## M-M-
## 22
proxy.ts matcher
/api/cron and /api/auth excluded from auth refresh. The
exclusion of /api/auth (note: the project has no such
directory; only /auth/*) is harmless, but api/cron
exclusion compounds C-2.
DoSAlready handled by C-2 fixes.
## M-M-
## 33
app/api/vitals/route.ts
Unauthenticated POST accepts arbitrary payload, drained
but not validated.
Log/DoS
amplification
Cloudflare rate-limit
/api/vitals to 100 req/min/IP;
require an Origin header
matching canonical host.
## M-M-
## 44
lib/email.ts
Brevo HTML built via template strings interpolating
${fullName} and ${email} directly — admin-controlled but
still a stored-XSS vector against admins reading their own
copy.
Email-XSS
Configure Brevo Sender to
reject HTML emails containing
<script or on*= patterns; use
the Brevo "Sanitize HTML" pre-
send filter.
## M-M-
## 55
update-password-form.tsx
Min password length 6, no complexity, no breach-list
check.
## Weak
credentials
## Set
## GOTRUE_PASSWORD_MIN_LENGTH=12
and enable
GOTRUE_PASSWORD_HIBP=true on
the Supabase GoTrue
container.

## M-M-
## 66
app/(dashboard)/...
Pages depend on proxy.ts running on every navigation,
but _next/static and a pile of
.svg/.png/.jpg/.jpeg/.gif/.webp/.ico are excluded —
fine — but .pdf, .docx, .txt are notnot excluded yet
downloads route through /api/download so OK. HoweverHowever
the matcher excludes the matcher excludes .ico.ico allowing arbitrary  allowing arbitrary *.ico*.ico paths paths
to skip auth.to skip auth.
## Path-traversal-
style
enumeration
Tighten Cloudflare to block any
path matching .ico not in
## /favicon.ico.
## M-M-
## 77
app/auth/callback/route.ts and
signout/route.ts
Build origin from x-forwarded-host → host-header
injection variant of C-3 for cookie-clearing redirects.
## Phishing-on-
logout
Pin NEXT_PUBLIC_SITE_URL; WAF
Host pinning (same as C-3 step
## 1–2).
## M-M-
## 88
app/actions/submissions.ts
(createSubmission)
Uses admin clientadmin client to bypass RLS on submissions.insert
and task_assignments.update. Defense rests entirely on
the in-process requireProfile() + deadline checks.
RLS-escape if
action
regression
Force RLS for service role on
submissions and
task_assignments (ALTER TABLE
## ... FORCE ROW LEVEL SECURITY)
and grant the service-role
INSERT/UPDATE only via a
SECURITY DEFINER function that
takes uploader_id as a
parameter and asserts =
auth.uid().
## M-M-
## 99
lib/auth.ts requireRole
Falls back to redirect("/dashboard") instead of returning
403, so a non-authorised role calling a server action sees a
redirect URL — leaks role boundaries by side-effect.
Info disclosure
Sanitise via WAF: any redirect
to /dashboard from a POST to
/dashboard/*/action should be
rewritten to a generic
/auth/error page.
## M-M-
## 1010
lib/data.ts listAnnouncements /
listMaterials
## Use
.or(\expires_at.is.null,expires_at.gt.$nowIso)—nowIsois
server-generated so safe, but the OR-string PostgREST
builder pattern inlistRules
(team_id.eq.$profile.team_id) interpolates team_id.
team_id is a UUID from DB (safe) but a future change to
populate from headers/JWT claim could open injection.
Latent SQL
injection
Add a Supabase database
firewall (e.g., pgFirewall plugin)
blocking OR expressions in
PostgREST queries from the
anon role.
## M-M-
## 1111
next.config.mjs connect-src
Allows wss://*.up.railway.app and
https://*.up.railway.app — any other Railway tenant can
host an exfiltration endpoint reachable from the browser if
XSS were achieved.
## Data-exfil
amplifier
Replace wildcards with the
exact Kong host in a Cloudflare
Transform Rule overriding the
CSP header.
## M-M-
## 1212
app/api/smart-ai/upload/route.ts
Empty file.type (omitted multipart Content-Type)
bypasses the ACCEPTED.has(file.type) allow-list because
the guard is if (file.type && ...). The same skip exists
in createSubmission.
## Accept
arbitrary
content
Cloudflare WAF rule: reject
multipart uploads where any
part lacks Content-Type. Block
Content-Type: text/html,
image/svg+xml.
## M-M-
## 1313
lib/smart-ai/indexer.ts
embedTexts
Sends user-uploaded document text and chat message
text to OpenAI/OpenRouter. Texts may contain PII or task
content.
## Third-party
data exposure
Negotiate a zero-retention
agreement (OpenAI X-OpenAI-
Skip-Logging header is GA —
already requestable for paid
keys). Set
OPENAI_DATA_RETENTION=zero
and verify with OpenAI Trust
portal. For OpenRouter, pin to
providers that honour data:
## {policy: "no-store"}.
## M-M-
## 1414
app/api/smart-ai/chat/route.ts
(onFinish)
Persists assistant response (text) and the full user
message verbatim to chat_messages via the service role.
No length cap, no PII filter.
Long-term PII
retention
Configure a Postgres pgcron
job that purges chat_messages
older than N days, enforcing
your retention policy without
code changes.
## M-M-
## 1515
app/api/cron/mark-
missed/route.ts
When secret matches, the route still iterates through R2
deletes inside the request handler — a long-running
operation that ties up the worker. A bot that obtains the
secret can wedge the host.
DoS
Set Railway's per-cron
concurrency to 1 and put the
route behind a Cloudflare 60s
response timeout to drop
wedged requests.
## M-M-
## 1616
next.config.mjs headers()
Missing Cross-Origin-Opener-Policy: same-origin,
Cross-Origin-Embedder-Policy: require-corp, Cross-
Origin-Resource-Policy: same-origin.
## Spectre/embed
risk for
sensitive pages
Add via Cloudflare Transform
Rule on /dashboard/*.
## M-M-
## 1717
lib/supabase/admin.ts
Cached singleton across requests. A leaked stack trace
including the client object would expose key.
Info disclosure
Disable React error overlays on
prod (already default), and
disable Next's errors.tsx body
rendering server crash details.
Sentry should not include
##File / IssueFile / IssueDescriptionDescriptionImpactImpactNon-intrusive MitigationNon-intrusive Mitigation

process.env.
## M-M-
## 1818
app/api/smart-ai/health/route.ts
Exposes pg host/port/db/user/SSL state and checks env-
var presence (plaintext booleans) to any signed-in userany signed-in user
(just requireProfile()).
Recon for an
internal
attacker
Restrict via Cloudflare Access
on /api/smart-ai/health to
operator group; or add WAF
rule requiring an X-Operator-
Key header.
## M-M-
## 1919
app/actions/users.ts
provisionUser
Lets admin create a new main_admin (no extra
confirmation).
## Privilege
escalation if
admin account
compromised
Add a Cloudflare Access policy
requiring step-up
(TouchID/Yubikey) on the
/dashboard/team path.
## M-M-
## 2020
lib/llm/pipeline.ts
If Redis is unavailable, idempotency lock is skipped —
duplicate processSubmission runs can corrupt
validation_runs and double-charge LLM credits.
Integrity / cost
Treat missing Redis as a
deploy-time failure (env-var
guard at boot) — already
covered by H-4 fix.
## M-M-
## 2121
scripts/003_rls_policies.sql
profiles_select allows ANY authenticated user to read
every profile row across all teams. Members can
enumerate emails of other tenants.
PII leakage
Replace policy via Supabase
Studio (operator action, not
code) with using (auth.uid() =
id OR public.is_main_admin()
## OR
## (public.current_user_role() =
'manager' AND team_id =
public.current_user_team())).
## M-M-
## 2222
scripts/008_fix_manager_auth.sql
is_manager_of only checks profiles.team_id =
target_team, no longer requires the teams.manager_id =
auth.uid() link. Any user whose role is later flipped toAny user whose role is later flipped to
'manager''manager' and who shares a team with members and who shares a team with members
suddenly inherits manager rightssuddenly inherits manager rights — including across
reassignments.
Privilege creep
Re-apply the original
teams.manager_id =
auth.uid() predicate in Studio
(operator change).
## M-M-
## 2323
app/actions/teams.ts
assignTeamManager
Updates manager_id and member's team_id without
verifying the new manager isn't already running another
team.
Manager hijack
of two teams
Add a Postgres CHECK
constraint or trigger asserting
(SELECT COUNT(*) FROM teams
WHERE manager_id =
NEW.manager_id) <= 1. Apply
via Studio.
##File / IssueFile / IssueDescriptionDescriptionImpactImpactNon-intrusive MitigationNon-intrusive Mitigation
- Low-Severity / Hardening4. Low-Severity / Hardening
| # | Issue | Mitigation |-----|-----|-----|-----|----- | L-1 | Permissions-Policy only restricts camera/mic/geolocation. | Extend at the edge with interest-cohort=(), payment=(), usb=(),
clipboard-read=(self). | L-2 | No SRI for external font CDN (fonts.gstatic.com, frontend-cdn.perplexity.ai). | Add SRI hashes via Cloudflare Transform rule, or proxy fonts
through /api/fonts/[...]. | L-3 | Activity-log endpoints store ip_address, user_agent in metadata. Old rows accumulate forever. | Pgcron monthly delete, retention 12 months. |
L-4 | bcrypt in package.json but not used anywhere. | Remove via Renovate / dependabot (operator action). | L-5 | pnpm-lock.yaml not gated by Snyk / OSV-Scanner in CI. | Add
OSV-Scanner GitHub Action — config-only, no code change. | L-6 | No 2FA for admins. | Enable Supabase MFA via GoTrue env (GOTRUE_MFA_ENABLED=true). | L-7 | bcrypt not
enforced; passwords stored by GoTrue (good) but no breach-list. | Enable GoTrue HIBP (M-5). | L-8 | First-user-becomes-admin trigger (handle_new_user). If signup ever re-opens, first
attacker takes over. | Add a pgcron task that asserts SELECT COUNT(*) FROM profiles WHERE role='main_admin' = (whitelist count) and pages on alarm. | L-9 |
dangerouslySetInnerHTML in components/ui/chart.tsx. Not currently fed user data, but watch for regressions. | Add CodeQL workflow scanning for new sinks. | L-10 |
DocumentParseserror messages forwarded to client via details: dbError?.message. | Edge response-stripper (covered in H-9). | L-11 | proxy.ts matcher excludes static asset
extensions but on a 30s staleTimes.dynamic window — RSC pages may serve stale role-mutated data. | Operator: review session/role rotation cadence; for Main Admin demotions,
additionally invalidate via Supabase RPC invalidate_user_sessions (already used). | L-12 | Welcome and password-reset emails do not enforce TLS-only delivery. | Configure Brevo
"Force TLS" for outbound mail. | L-13 | SUPABASE_DB_URL may contain stray template syntax (per pg-client.ts warning). | Add a deploy-time guard env-var sanity check via Railway
healthcheck. | L-14 | chat_documents allows uploading the same file ad infinitum — no per-user storage cap. | R2 lifecycle rule: delete chat-documents/<user>/* older than 30 days. |
L-15 | cors not configured on R2 bucket — public reads possible if R2_PUBLIC_URL is exposed. | Set R2 bucket to "Private" + force all access through the /api/download proxy.
## 5. Recommended Operational Playbook5. Recommended Operational Playbook
A consolidated checklist of deploy-time / runtime controls that mitigate the majority of findings without touching source:
- Environment variables to set in Railway / Vercel:Environment variables to set in Railway / Vercel:
- NEXT_PUBLIC_SITE_URL = canonical host (mitigates C-3, M-7).
- CRON_SECRET = 64-char hex (mitigates C-2).
- UPSTASH_REDIS_REST_URL / _TOKEN (mitigates H-4, M-20).
- GOTRUE_PASSWORD_MIN_LENGTH=12, GOTRUE_PASSWORD_HIBP=true, GOTRUE_MFA_ENABLED=true, GOTRUE_COOKIE_SAMESITE=strict, GOTRUE_COOKIE_SECURE=true (M-5,
## L-6, H-7).
- RAG_BOOTSTRAP_DISABLED=true for prod once schema is stable (H-6).
- OPENAI_DATA_RETENTION=zero and equivalent OpenRouter policy (M-13).
- Cloudflare WAF / Workers (or Vercel Edge Config) to deploy:Cloudflare WAF / Workers (or Vercel Edge Config) to deploy:
- Block /api/admin/* (C-1).

- Strip / pin next query params (C-4, M-1).
- Pin Host header to canonical (C-3, M-7).
- Force Content-Disposition: attachment and rewrite Content-Type for /api/download/* HTML/SVG (H-2).
- Override CSP with nonce-based script-src and tighter connect-src (H-1, M-11).
- Rate-limit /auth/login (5/min/ip), /auth/forgot-password (3/hr/ip), DELETE /api/smart-ai/threads/* (5/min/user), /api/vitals (100/min/ip) (H-3, H-4, H-5, M-3).
- Origin/Referer enforcement on /auth/* POSTs (H-7).
- Postgres / Supabase Studio operator changes:Postgres / Supabase Studio operator changes:
- Reapply original is_manager_of linking to teams.manager_id (M-22).
- Tighten profiles_select to scope by team or admin (M-21).
- ALTER TABLE chat_messages, submissions, task_assignments FORCE ROW LEVEL SECURITY; and add delete policies (H-5, H-8, M-8).
- Create a least-privilege Postgres role for the runtime; switch SUPABASE_DB_URL to it; revoke ALTER, CREATE FUNCTION, NOTIFY (C-1).
- Enable pgaudit and ship logs to SIEM (H-8).
- Pgcron: purge chat_messages and activity_log per retention policy (M-14, L-3).
- R2 bucket configuration:R2 bucket configuration:
- Bucket privacy = Private, no public-read.
- Object Lambda strips/normalises Content-Type (H-2).
- Lifecycle rule deleting chat-documents/* after 30 days (L-14).
- Brevo configuration:Brevo configuration:
- Disable email-body retention (H-10, M-4).
- Force TLS (L-12).
- Pre-send HTML sanitisation (M-4).
- Monitoring & response:Monitoring & response:
- Sentry alerts on: [redis] init returned null, repeated forgot-password failures, cron.mark-missed 200-without-Authorization, chat_messages deletes by non-owner
## (H-4, H-3, C-2, H-5).
- Quarterly secret-rotation: SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, BREVO_API_KEY, OPENROUTER_API_KEY, R2_*, GoTrue JWT_SECRET.
- Add OSV-Scanner GitHub Action to fail PRs with vulnerable deps (L-5).
## 6. Summary Table6. Summary Table
| ID | Severity | Theme | Status |-----|-----|-----|-----|----- | C-1 | Critical | Unauth admin DDL endpoint | Mitigate via WAF + key rotation | C-2 | Critical | Cron auth fails open | Set CRON_SECRET +
WAF | C-3 | Critical | Host-header injection in reset emails | Pin NEXT_PUBLIC_SITE_URL + WAF | C-4 | High/Critical | Open redirect (login + callback) | Edge next allow-list | H-1 | High |
Loose CSP | Nonce-based CSP at edge | H-2 | High | Stored-XSS via download proxy | Force-attachment + content-type rewrite | H-3 | High | Account enumeration via reset | Edge response
normalisation | H-4 | High | Rate limiters silently disabled | Set Upstash env + Cloudflare RL | H-5 | High | Cross-tenant chat-message deletion | RLS + smaller service role | H-6 | High |
Bootstrap RPC open to all users | Cloudflare Access | H-7 | High | CSRF on custom POST routes | SameSite + Origin enforcement | H-8 | High | Service-role bypasses RLS broadly | FORCE
RLS + pgaudit | H-9 | High | Verbose error leaks schema | Edge body rewriter | H-10 | High | Plaintext passwords in welcome emails | Brevo retention 0 | M-1..M-23 | Medium | Various (see
table) | Per-row plan | L-1..L-15 | Low | Hardening | Per-row plan
The highest-leveragehighest-leverage action you can take today, with no code changes, is the four-step bundle: (1) set CRON_SECRET and NEXT_PUBLIC_SITE_URL, (2) block /api/admin/* and
/api/smart-ai/bootstrap at the edge, (3) configure Cloudflare rate-limits on auth endpoints, and (4) FORCE RLS on chat_messages, submissions, and task_assignments in
Supabase Studio. That neutralises every Critical and most High findings within an hour. The remaining items can be staged into the next sprint as code patches.