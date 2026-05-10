import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.POSTGRES_URL ||
    "postgresql://supabase_admin:27jqy5tqxtdl5cfpfi3ust8pn41hbqtch0nmcbpo9s9rpo0087vxulbm6lmp47vx@tramway.proxy.rlwy.net:58446/postgres",
  ssl: false,
});

async function run(label, sql) {
  try {
    await pool.query(sql);
    console.log(`✅ ${label}`);
  } catch (e) {
    console.error(`❌ ${label}: ${e.message}`);
    throw e;
  }
}

try {
  // 1. Add expires_at and granted_by columns
  await run(
    "Add expires_at column to user_permission_overrides",
    `ALTER TABLE public.user_permission_overrides
       ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT NULL`
  );

  await run(
    "Add granted_by column to user_permission_overrides",
    `ALTER TABLE public.user_permission_overrides
       ADD COLUMN IF NOT EXISTS granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT NULL`
  );

  // 2. Indexes
  await run(
    "Create index idx_upo_user_capability",
    `CREATE INDEX IF NOT EXISTS idx_upo_user_capability
       ON public.user_permission_overrides (user_id, capability_key)`
  );

  await run(
    "Create index idx_upo_expires_at",
    `CREATE INDEX IF NOT EXISTS idx_upo_expires_at
       ON public.user_permission_overrides (expires_at)
       WHERE expires_at IS NOT NULL`
  );

  // 3. Update has_capability to skip expired overrides
  await run(
    "Update has_capability function (expiry-aware)",
    `CREATE OR REPLACE FUNCTION public.has_capability(
       p_user_id    uuid,
       p_capability text
     ) RETURNS boolean
       LANGUAGE plpgsql
       STABLE
       SECURITY DEFINER
       SET search_path = public
     AS $$
     DECLARE
       v_role    text;
       v_effect  text;
       v_default boolean;
     BEGIN
       IF p_user_id IS NULL OR p_capability IS NULL THEN
         RETURN false;
       END IF;

       SELECT role::text INTO v_role FROM public.profiles WHERE id = p_user_id;
       IF v_role IS NULL THEN RETURN false; END IF;

       IF v_role = 'main_admin' THEN RETURN true; END IF;

       SELECT effect INTO v_effect
       FROM public.user_permission_overrides
       WHERE user_id        = p_user_id
         AND capability_key = p_capability
         AND (expires_at IS NULL OR expires_at > now());

       IF v_effect = 'deny'  THEN RETURN false; END IF;
       IF v_effect = 'allow' THEN RETURN true;  END IF;

       SELECT true INTO v_default
       FROM public.role_permission_defaults
       WHERE role = v_role AND capability_key = p_capability;

       RETURN COALESCE(v_default, false);
     END;
     $$`
  );

  await run(
    "Grant execute on has_capability",
    `GRANT EXECUTE ON FUNCTION public.has_capability(uuid, text) TO authenticated, anon, service_role`
  );

  // 4. Permission override history table
  await run(
    "Create permission_override_history table",
    `CREATE TABLE IF NOT EXISTS public.permission_override_history (
       id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
       capability text        NOT NULL,
       action     text        NOT NULL CHECK (action IN ('set_allow', 'set_deny', 'cleared')),
       allow      boolean,
       expires_at timestamptz,
       granted_by uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
       changed_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  await run(
    "Create index idx_poh_user_id",
    `CREATE INDEX IF NOT EXISTS idx_poh_user_id
       ON public.permission_override_history (user_id, changed_at DESC)`
  );

  // 5. RLS for history table
  await run(
    "Enable RLS on permission_override_history",
    `ALTER TABLE public.permission_override_history ENABLE ROW LEVEL SECURITY`
  );

  await run(
    "Create RLS policy poh_select_admin",
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE tablename = 'permission_override_history' AND policyname = 'poh_select_admin'
       ) THEN
         CREATE POLICY "poh_select_admin" ON public.permission_override_history
           FOR SELECT USING (public.has_capability(auth.uid(), 'user_management.permissions'));
       END IF;
     END $$`
  );

  await run(
    "Create RLS policy poh_insert_admin",
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE tablename = 'permission_override_history' AND policyname = 'poh_insert_admin'
       ) THEN
         CREATE POLICY "poh_insert_admin" ON public.permission_override_history
           FOR INSERT WITH CHECK (public.has_capability(auth.uid(), 'user_management.permissions'));
       END IF;
     END $$`
  );

  // 6. Reload PostgREST schema cache
  await run("Reload PostgREST schema cache", `NOTIFY pgrst, 'reload schema'`);

  console.log("\n🎉 Permissions expiry migration complete!");
} catch {
  console.error("\n💥 Migration aborted due to error above.");
  process.exit(1);
} finally {
  await pool.end();
}
