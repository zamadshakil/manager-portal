# Auth & Session Notes

Operational reference for the Supabase session lifecycle in the manager portal. Read this if a user reports being "randomly signed out" or if you see `[proxy] auth` warnings in Railway logs.

## How the session is maintained

- The browser holds two cookies set by GoTrue via `@supabase/ssr`:
  - `sb-<project-ref>-auth-token` — current access token (JWT, ~1 h TTL by default).
  - `sb-<project-ref>-auth-token.<n>` — chunked overflow when the JSON exceeds the cookie size limit.
- On every (non-static) request, the edge proxy at `proxy.ts` calls `updateSession()` in `lib/supabase/proxy.ts`. That function:
  1. Calls `supabase.auth.getUser()`. If the access token is within the refresh window, GoTrue rotates it and returns new cookies.
  2. Writes the new cookies onto **both** the mutated `request` (so downstream RSC/route handlers see the fresh session) and the outgoing response (so the browser stores them).
  3. If `getUser()` returns `null` and the path is not public, redirects to `/auth/login`. Any rotated cookies are copied onto the redirect response.
- Sign-out (`/auth/signout`) uses `scope: 'local'` — it clears local cookies only, no GoTrue round-trip.

## The refresh-token rotation window (why "random" sign-outs happened)

GoTrue refresh tokens are **single-use**. When the proxy consumes the old refresh token, GoTrue invalidates it server-side and issues a new one. Two failure modes used to cause unexpected sign-outs:

1. **Stale request headers forwarded downstream.** The proxy used to rebuild the response with a frozen pre-mutation header snapshot (`NextResponse.next({ request: { headers: requestHeaders } })`). The browser received the new cookies, but the same in-flight request handed the **old** cookie to the dashboard layout, which then called `getUser()`, hit a now-invalid refresh token, and redirected to `/auth/login`.
2. **Redirect path discarded rotated cookies.** When the proxy decided to bounce the user to `/auth/login`, it created a fresh `NextResponse.redirect(url)` without copying any cookies Supabase had just staged. So a partially-rotated session was thrown away on the redirect.

Both are fixed (Nov 2026). The proxy now uses `NextResponse.next({ request })` and copies cookies onto the redirect response.

## Diagnostic warning

When `getUser()` returns `null` but the request carried an `sb-*-auth-token` cookie, the proxy now logs:

```
[proxy] auth cookie present but getUser() returned null trace=<traceId> path=<pathname>
```

The `traceId` matches the `x-trace-id` header on the response, so you can correlate user reports with exact log lines. Expected baseline: rare (only on truly expired sessions or transient GoTrue 5xx). A spike means GoTrue is rejecting valid tokens — check Railway logs for the `auth` service and Postgres connectivity.

## Client clock skew (the "some PCs" symptom)

JWTs encode an `exp` claim in **absolute UTC seconds**. If a Windows PC has a clock more than ~1–2 minutes ahead of real time, both the browser and any local SDK that pre-validates `exp` will mark a still-valid token as expired and force a refresh. If the clock is *behind*, the proxy may accept a token GoTrue considers expired, then fail at the next refresh attempt.

If a specific user reports frequent sign-outs:

1. Have them run `w32tm /query /status` in PowerShell. `Last Successful Sync Time` should be within the last 24 hours.
2. Force a sync: `w32tm /resync /force` (admin shell).
3. Verify Windows Time service is running and set to automatic.

This is a client-side issue and cannot be fully fixed in the app, but the rotation window is now wide enough (with the proxy bug fixed) that <2 minutes of skew is tolerated.

## Knobs (self-hosted GoTrue on Railway)

The defaults are sane; tune only on evidence.

- `GOTRUE_JWT_EXP` — access-token TTL in seconds. Default `3600`. Lower = more refreshes (more proxy load), higher = larger blast radius if a token leaks.
- `GOTRUE_REFRESH_TOKEN_REUSE_INTERVAL` — grace window during which the same refresh token may be presented twice without invalidating the family. Default `10`. Increase to e.g. `30` only if you see legitimate concurrent-tab races in the new `[proxy] auth` warnings.

## Related code

- `proxy.ts` — Next 16 edge middleware entrypoint.
- `lib/supabase/proxy.ts` — `updateSession()` (cookie rotation + auth gate).
- `lib/supabase/server.ts` — RSC/route-handler client.
- `lib/supabase/client.ts` — browser client.
- `lib/auth.ts` — `requireProfile()` / `requireRole()` helpers (cached per request).
- `app/auth/signout/route.ts` — sign-out endpoint (CSRF-protected, `scope: 'local'`).
