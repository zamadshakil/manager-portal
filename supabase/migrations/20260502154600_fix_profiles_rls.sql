-- Update profiles RLS to allow authenticated users to read all profiles.
-- This is necessary so that managers can see the 'creator_role' of rules created by main_admins.
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);
