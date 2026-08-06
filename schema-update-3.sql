-- ============================================================
-- SUPERSEDED — do not rely on this file.
--
-- Testing showed hosted Supabase blocks a plain SQL DELETE against
-- auth.users even from a SECURITY DEFINER function (no error is raised,
-- the row just never actually goes away). The real fix is the
-- supabase/functions/delete-account Edge Function, which uses the
-- Admin API (auth.admin.deleteUser) via the service-role key. Deploy
-- that function instead — see supabase/functions/delete-account/index.ts.
--
-- This function is left in place harmlessly (nothing calls it anymore)
-- in case it's useful for manual cleanup from the SQL Editor, e.g.:
--   select public.delete_own_account(); -- run this while impersonating
-- but it is NOT part of the app's delete flow anymore.
-- ============================================================
-- Update 3: real account deletion
-- Run this in Supabase SQL Editor (safe to re-run)
--
-- Problem this fixes:
--   "Delete profile" only ran `delete from public.profiles`, but there was
--   no RLS policy allowing users to delete their own profile row, so the
--   delete silently matched 0 rows. Worse, even if it had worked, the
--   underlying auth.users record was never removed, so the same email
--   could just sign back in and the account (or a broken half-deleted
--   version of it) was still there.
--
-- Fix:
--   A SECURITY DEFINER function that removes the auth.users row for the
--   caller. Every app table (profiles, posts, messages, jobs, events,
--   likes, comments, conversation_participants) references
--   public.profiles(id) with `on delete cascade`, and public.profiles.id
--   references auth.users(id) with `on delete cascade`, so deleting the
--   auth user cascades through and removes all of that person's data in
--   one shot. We also clean up their storage objects (avatar + post
--   images), which aren't covered by the FK cascade.
--
--   Once auth.users is gone, their old email/password no longer works —
--   Supabase will reject sign-in with "Invalid login credentials" — so
--   they have to sign up again as a brand new account, starting from
--   scratch, exactly like the app intends.
-- ============================================================

create or replace function public.delete_own_account()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Remove storage objects not covered by FK cascade
  delete from storage.objects
  where bucket_id in ('avatars', 'post-images')
    and (storage.foldername(name))[1] = uid::text;

  -- Deleting the auth user cascades to public.profiles and everything
  -- that references it (posts, messages, jobs, events, likes, comments...)
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_own_account() to authenticated;
