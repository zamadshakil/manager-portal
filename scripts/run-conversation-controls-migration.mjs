/**
 * Applies the messaging conversation-controls migration:
 *   - Adds cleared_at + hidden_at to conversation_members
 *   - Rebuilds get_conversation_previews with correct filters
 *   - Reloads the PostgREST schema cache (critical on self-hosted Supabase)
 *
 * Run with:
 *   node scripts/run-conversation-controls-migration.mjs
 *
 * The DATABASE_URL / SUPABASE_DB_URL env var must point at the Postgres DB.
 * If you have a .env.local, export those vars first:
 *   $env:DATABASE_URL="postgresql://supabase_admin:<pass>@<host>:<port>/postgres"
 *   node scripts/run-conversation-controls-migration.mjs
 */

import pg from "pg"
const { Pool } = pg

const connectionString =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL

if (!connectionString) {
  console.error("❌ No DATABASE_URL / SUPABASE_DB_URL env var found.")
  console.error("   Set it and re-run:  $env:DATABASE_URL=\"postgresql://...\"")
  process.exit(1)
}

const pool = new Pool({ connectionString, ssl: false })

async function run(label, sql) {
  try {
    await pool.query(sql)
    console.log(`✅ ${label}`)
  } catch (e) {
    console.error(`❌ FAILED [${label}]:`, e.message)
    throw e
  }
}

try {
  await run(
    "Add removed_at to conversation_members",
    `ALTER TABLE public.conversation_members
       ADD COLUMN IF NOT EXISTS removed_at timestamptz`
  )

  await run(
    "Add removed_by to conversation_members",
    `ALTER TABLE public.conversation_members
       ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES public.profiles(id)`
  )

  await run(
    "Add cleared_at to conversation_members",
    `ALTER TABLE public.conversation_members
       ADD COLUMN IF NOT EXISTS cleared_at timestamptz`
  )

  await run(
    "Add hidden_at to conversation_members",
    `ALTER TABLE public.conversation_members
       ADD COLUMN IF NOT EXISTS hidden_at timestamptz`
  )

  await run(
    "Drop old get_conversation_previews (return type is changing)",
    `DROP FUNCTION IF EXISTS public.get_conversation_previews(uuid)`
  )

  await run(
    "Create new get_conversation_previews",
    `CREATE OR REPLACE FUNCTION public.get_conversation_previews(p_user_id uuid)
RETURNS TABLE(
  id              uuid,
  type            text,
  name            text,
  created_by      uuid,
  avatar_url      text,
  created_at      timestamptz,
  updated_at      timestamptz,
  members         json,
  removed_members json,
  last_message    json,
  unread_count    bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    c.id, c.type::text, c.name, c.created_by, c.avatar_url, c.created_at, c.updated_at,

    (SELECT json_agg(json_build_object(
        'user_id', cm2.user_id, 'role', cm2.role,
        'joined_at', cm2.joined_at, 'last_read_at', cm2.last_read_at,
        'removed_at', cm2.removed_at,
        'profile', json_build_object(
          'id', p.id, 'full_name', p.full_name,
          'email', p.email, 'avatar_url', p.avatar_url, 'deleted_at', p.deleted_at
        )))
     FROM public.conversation_members cm2
     JOIN public.profiles p ON p.id = cm2.user_id
     WHERE cm2.conversation_id = c.id AND cm2.removed_at IS NULL
    ) AS members,

    (SELECT json_agg(json_build_object(
        'user_id', cm3.user_id, 'role', cm3.role,
        'joined_at', cm3.joined_at, 'removed_at', cm3.removed_at, 'removed_by', cm3.removed_by,
        'profile', json_build_object(
          'id', p2.id, 'full_name', p2.full_name,
          'email', p2.email, 'avatar_url', p2.avatar_url, 'deleted_at', p2.deleted_at
        )))
     FROM public.conversation_members cm3
     JOIN public.profiles p2 ON p2.id = cm3.user_id
     WHERE cm3.conversation_id = c.id AND cm3.removed_at IS NOT NULL
    ) AS removed_members,

    (SELECT row_to_json(lm)
     FROM (SELECT id, content, type::text AS type, sender_id, created_at, deleted_at
           FROM public.messages
           WHERE conversation_id = c.id AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 1) lm
    ) AS last_message,

    (SELECT COUNT(*)::bigint FROM public.messages m2
     WHERE m2.conversation_id = c.id
       AND m2.deleted_at IS NULL
       AND m2.created_at > COALESCE(cm.last_read_at, '-infinity'::timestamptz)
       AND (cm.cleared_at IS NULL OR m2.created_at > cm.cleared_at)
    ) AS unread_count

  FROM public.conversations c
  JOIN public.conversation_members cm
    ON cm.conversation_id = c.id
   AND cm.user_id = p_user_id
   AND cm.removed_at IS NULL
   AND cm.hidden_at IS NULL

  ORDER BY c.updated_at DESC;
$$`
  )

  await run(
    "Grant execute to service_role",
    `GRANT EXECUTE ON FUNCTION public.get_conversation_previews(uuid) TO service_role`
  )

  // Critical on self-hosted Supabase: PostgREST caches the DB schema and
  // won't recognise new columns until it receives this notification.
  await run(
    "Reload PostgREST schema cache",
    `NOTIFY pgrst, 'reload schema'`
  )

  console.log("\n🎉 Migration complete! All features should now work.")
} catch {
  console.error("\n💥 Migration aborted due to error above.")
  process.exit(1)
} finally {
  await pool.end()
}
