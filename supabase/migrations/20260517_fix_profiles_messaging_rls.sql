-- =============================================================================
-- Security fix: narrow profiles_select_for_messaging RLS policy
-- =============================================================================
-- The policy added by 20260508_profile_soft_delete.sql used USING (true),
-- which exposed the full profiles table to any request including unauthenticated
-- ones routed via the anon key. Narrow to authenticated sessions only.
-- The intent (show sender name/avatar in chat history) is fully preserved:
-- only logged-in users can be in a conversation.
-- =============================================================================

DROP POLICY IF EXISTS "profiles_select_for_messaging" ON public.profiles;

CREATE POLICY "profiles_select_for_messaging" ON public.profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);
