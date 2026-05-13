# Access Control — Audit & Improvements

> Implemented: May 9, 2026

---

## Overview

This document records every security fix, database migration, server-side change, and UI improvement delivered as part of the Access Control audit and Admin UX enhancement pass.

---

## 1. Security Fix — RLS Policy Narrowing

### File
`supabase/migrations/20260517_fix_profiles_messaging_rls.sql`

### Problem
The `profiles_select_for_messaging` policy introduced in `20260508_profile_soft_delete.sql` used `USING (true)`, which exposed the entire `profiles` table to **any** request — including unauthenticated ones routed via the Supabase anon key.

### Fix
Replaced `USING (true)` with `USING (auth.uid() IS NOT NULL)`.

- Authenticated users can still read all profiles (required for showing sender names/avatars in message history).
- Unauthenticated requests are now blocked at the RLS layer.
- No legitimate use-case is broken.

```sql
-- Before
CREATE POLICY "profiles_select_for_messaging" ON public.profiles
  FOR SELECT USING (true);

-- After
CREATE POLICY "profiles_select_for_messaging" ON public.profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);
```

---

## 2. Database Migration — Override Expiry & History

### File
`supabase/migrations/20260517_permission_overrides_expiry.sql`

### Changes

#### 2a. New columns on `user_permission_overrides`
| Column | Type | Purpose |
|---|---|---|
| `expires_at` | `timestamptz` (nullable) | Optional expiry timestamp; `NULL` means no expiry |
| `granted_by` | `uuid` (FK → `profiles`) | Records which admin set the override |

#### 2b. Updated SQL functions
Both `has_capability` and `has_scoped_capability` were updated to **skip expired override rows**:

```sql
AND (expires_at IS NULL OR expires_at > now())
```

This ensures that once an override expires it is automatically ignored by all RLS policies — no cron job or manual cleanup needed.

#### 2c. New table: `permission_override_history`
Full audit trail of every permission change.

| Column | Type |
|---|---|
| `id` | `uuid` PK |
| `user_id` | `uuid` FK → `profiles` |
| `capability` | `text` |
| `action` | `text` — `set_allow`, `set_deny`, or `cleared` |
| `allow` | `boolean` (nullable) |
| `expires_at` | `timestamptz` (nullable) |
| `granted_by` | `uuid` FK → `profiles` |
| `changed_at` | `timestamptz` |

RLS: readable and writable only by users with the `user_management.permissions` capability.

---

## 3. `lib/permissions.ts` — Type & Resolver Updates

### `UserOverrideRow` type
Two new fields added to match the new DB columns:

```ts
interface UserOverrideRow {
  // ...existing fields...
  granted_by_name: string | null   // display name of the granting admin
  expires_at: string | null        // ISO timestamp or null
}
```

### `loadPermissions` — expired override filtering
The Supabase query for user overrides now filters out expired rows at the database level using a `.or()` filter, so the application-level resolver always sees a consistent, expiry-aware view:

```ts
.or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
```

A type assertion (`.returns<>()`) bridges the gap until Supabase type generation is re-run against the new schema.

---

## 4. `app/actions/permissions.ts` — Server Action Updates

### 4a. `setUserPermissionOverride` — expiry support
- Schema extended with `expires_at: z.string().datetime().optional().nullable()`.
- Upsert payload now includes `expires_at`.
- Every call (set or clear) appends a row to `permission_override_history`.
- Activity log metadata updated to include `expires_at`.

### 4b. `loadPermissionAdminData` — granter name enrichment
Overrides are now enriched with the granter's display name in a secondary profiles lookup, so the UI can show _"Granted by Jane Doe"_ without a client-side join.

### 4c. New: `loadPermissionHistory(userId)`
Fetches up to 200 most-recent entries from `permission_override_history` for a given user, enriched with the granter's display name. Guarded by `requirePermissionAdmin()`.

```ts
const result = await loadPermissionHistory(userId)
// result.history: PermissionHistoryEntry[]
```

### 4d. New: `bulkSetUserPermissionOverrides`
Applies the same override effect to up to **200 users × 50 capabilities** in a single server call.

- Guards: no `main_admin` targets; no `is_admin_only` capabilities when granting.
- On `clear`: deletes existing rows one user at a time (required for `.in()` scoping).
- On `allow`: single batch upsert + single batch history insert. (Deny was removed in `20260524_remove_override_deny.sql`; overrides can no longer subtract capabilities.)
- Activity log records aggregate counts (`user_count`, `capability_count`).
- Returns `{ ok: true, failed?: string[] }` for partial-failure reporting.

---

## 5. `components/dashboard/permissions-matrix.tsx` — Full UI Rewrite

### 5a. Toolbar
- **Capability search** — filters visible capabilities by key or action name.
- **Module filter** — limits the matrix to a single module (e.g. `tasks`, `materials`).
- **Selected users badge** — shows count when bulk mode is active.
- **Export CSV button** — see §5g.

### 5b. User List Enhancements
- **User search** — filters by name or email.
- **Role filter** — shows only managers, only members, etc.
- **Bulk checkboxes** — each user row has a checkbox; "Select all visible" header toggle.
- **History button** (clock icon) — opens the history sheet for that user inline.
- Override count badge per user row is preserved.

### 5c. Bulk Edit Mode
When two or more users are checked, the matrix header switches to **bulk edit mode**. Every "Override" button in the matrix opens the override dialog targeting all selected users, calling `bulkSetUserPermissionOverrides` on save.

### 5d. Override Dialog
Replaces the old single-click buttons with a modal that provides full control:

| Field | Details |
|---|---|
| **Effect** | Two-button toggle: Allow / Clear (use default). Deny was removed; overrides can only grant capabilities. |
| **Reason** | Optional free-text textarea (max 500 chars) |
| **Expires on** | Optional date picker; shows amber preview when set |

The **Edit** button on capability rows is disabled when the state is `inherited_allow` (already granted via role default), since there is no useful action left to take.

The dialog title adapts for bulk mode ("Bulk override — N users").

### 5e. Explain Popover (ⓘ)
Every capability row now has an info button that opens a popover showing the **3-step decision chain**:

1. `main_admin` always allowed (not applicable)
2. Explicit allow override — highlights the granting admin if present
3. Role default — shows whether the user's role grants or denies

The active step is bolded; the final result is shown with colour coding (green = allow, red = deny). If the active override has an expiry date it is shown inline.

### 5f. Expiry Indicator
Capability rows with an active override that has an `expires_at` value show a clock icon and the localised expiry date directly in the capability name cell — visible at a glance without opening any dialog.

### 5g. CSV Export
The **Export CSV** button downloads a `permissions-export-YYYY-MM-DD.csv` file containing:

- Columns: `User`, `Email`, `Role`, then one column per capability key.
- Rows: one per non-admin user.
- Cell values: `override_allow`, `inherited_allow`, or `inherited_deny`.

The export reflects the current in-memory data (no extra server round-trip).

### 5h. History Panel
Clicking the history icon on any user row, or the **History** button in the matrix header, opens a slide-over sheet that lazily fetches and displays the override audit trail:

- Capability key
- Action badge (Allowed / Denied / Cleared)
- Timestamp, granting admin name, expiry date (where applicable)
- Up to 200 entries, newest first

---

## Decision Precedence (unchanged)

```
1. main_admin          → always allow (cannot be overridden)
2. allow override      → true   (explicit grant)
3. role_default match  → true   (inherited)
4. no match            → false
```

> **Deny override was removed in `20260524_remove_override_deny.sql`.** Overrides can only grant additional capabilities; role defaults are now the single source of denial. The `permission_override_history.action` enum still accepts `set_deny` so legacy audit rows remain readable.

Expired overrides are skipped at both the Postgres (`has_capability`) and application (`loadPermissions`) layers, so precedence is always evaluated against live, non-expired data.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/migrations/20260517_fix_profiles_messaging_rls.sql` | New — security fix |
| `supabase/migrations/20260517_permission_overrides_expiry.sql` | New — schema + function updates |
| `lib/permissions.ts` | `UserOverrideRow` type + expiry filter in `loadPermissions` |
| `app/actions/permissions.ts` | `expires_at` support, history writes, `loadPermissionHistory`, `bulkSetUserPermissionOverrides` |
| `components/dashboard/permissions-matrix.tsx` | Full rewrite — all Admin UX features |

> **No breaking changes.** The `PermissionsMatrix` component props are unchanged. Existing overrides without `expires_at` continue to work as permanent overrides.
