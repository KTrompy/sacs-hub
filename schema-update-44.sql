-- schema-update-44.sql
-- Admin account deletion.
--
-- Admins used to only be able to "Revoke" someone — that flipped
-- profiles.approved back to false, which locks them out of the site but
-- leaves the account, the profile and everything they ever posted sitting
-- in the database. There was no way to actually remove a person (a
-- duplicate signup, a bad-faith account, or someone who simply asked to be
-- taken off), short of opening the Supabase dashboard by hand.
--
-- This adds an RPC that deletes the underlying auth user. Every table that
-- hangs off a person cascades from there — auth.users → public.profiles →
-- posts, comments, likes, jobs, applications, events, RSVPs, businesses,
-- messages, reactions, notifications, reports, saved items — so one delete
-- clears the lot. (notifications.actor_id and reports.reviewed_by are
-- ON DELETE SET NULL rather than CASCADE, so other people's notifications
-- and moderation history survive with the actor blanked out, which is what
-- we want.)
--
-- Deleting auth.users requires elevated rights, hence SECURITY DEFINER —
-- modelled on delete_own_account() from the account-deletion work. The
-- guards below are what keep it from being a privilege-escalation hole:
-- the caller must themselves be an admin, and nobody can delete their own
-- account through it (that's what Settings → Delete account is for, and
-- blocking it here stops an admin nuking the account they're signed in
-- with by misclicking a row in the members table).

create or replace function public.admin_delete_member(target_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete member accounts';
  end if;

  if target_id = auth.uid() then
    raise exception 'You can''t delete your own account here — use Settings instead';
  end if;

  delete from auth.users where id = target_id;
end;
$$;

revoke all on function public.admin_delete_member(uuid) from public, anon;
grant execute on function public.admin_delete_member(uuid) to authenticated;
