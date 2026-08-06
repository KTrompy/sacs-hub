-- ============================================================
-- Update 39: SECURITY — prevent members from self-elevating to
-- admin via the profiles UPDATE policy.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================
--
-- Background: the original "Users can update own profile" policy
-- (see schema.sql) only guarded against a member setting their own
-- `approved` flag to true. When schema-update-8.sql later added the
-- `is_admin` column, that column was left off the with_check clause,
-- so any signed-in member could run:
--
--   supabase.from('profiles').update({ is_admin: true }).eq('id', me)
--
-- ...and PostgREST would happily flip the flag. That in turn unlocked
-- every "Admins can …" policy (delete any post/comment/job/event, pin
-- posts, admin_list_members RPC, etc.).
--
-- This migration re-defines the self-update policy with an explicit
-- assertion that both `approved` and `is_admin` on the incoming row
-- match whatever the caller's current profile row already has —
-- meaning members can update every other column on themselves, but
-- can no longer promote themselves (or un-approve/un-admin themselves,
-- which was never intended either). Admins keep full control via the
-- separate "Admins can update any profile" policy from update-8.

drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and approved = (select approved from public.profiles where id = auth.uid())
    and is_admin = (select is_admin from public.profiles where id = auth.uid())
  );
