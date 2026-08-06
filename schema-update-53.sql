-- schema-update-53.sql — auth-flow audit fixes (SIGNUP_LOGIN_AUDIT_2026_08_02.md)
--
-- Three unrelated things, all from the same audit:
--   C3  ensure_profile()  — recovery for an auth user with no profiles row
--   H6  drop admin_delete_member() — superseded, callable, silently no-ops
--   M5  gate reports INSERT on is_approved()
--
-- Safe to re-run.


/* ---------------------------------------------------------------------------
   C3 — ensure_profile(): un-brick an account with no profiles row
   ---------------------------------------------------------------------------

   handle_new_user() deliberately swallows its own errors (`exception when
   others then raise warning …; return new`) so a hiccup in the profile insert
   can't take the whole signup down with it. The cost of that choice is that a
   signup CAN complete and leave an auth user with no profiles row.

   Until now that state was unrecoverable from inside the app: `profiles` has
   no INSERT policy for `authenticated` (the row is only ever created by the
   trigger), so the person lands on App.jsx's ProfileLoadError screen whose two
   buttons — Try again and Sign out — both fail forever. Only direct database
   access could fix it.

   Deliberately an RPC rather than a self-insert RLS policy. A policy would let
   any signed-in client INSERT into profiles with arbitrary column values; the
   only thing they actually need is "create my empty row if it's missing", and
   the escalation-prevention triggers only fire on UPDATE. This function does
   exactly that one thing, sets nothing an attacker would want, and is a no-op
   when the row already exists.

   `approved` and `is_admin` are left at their column defaults (false, false)
   and `consented_at` at null, so a self-healed row still has to go through
   FinishSignup and admin approval like everyone else. It is not a way in. */
create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.profiles;
  v_meta jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_row from public.profiles where id = v_uid;
  if found then
    return v_row;
  end if;

  -- Same name-from-metadata logic handle_new_user uses, so a self-healed row
  -- looks identical to one the trigger would have written.
  select raw_user_meta_data into v_meta from auth.users where id = v_uid;
  v_meta := coalesce(v_meta, '{}'::jsonb);

  insert into public.profiles (id, full_name)
  values (
    v_uid,
    coalesce(
      nullif(btrim(v_meta->>'full_name'), ''),
      nullif(btrim(v_meta->>'name'), ''),
      ''
    )
  )
  on conflict (id) do nothing;

  select * into v_row from public.profiles where id = v_uid;
  return v_row;
end;
$$;

revoke execute on function public.ensure_profile() from public, anon;
grant  execute on function public.ensure_profile() to authenticated;


/* ---------------------------------------------------------------------------
   H6 — drop admin_delete_member()
   ---------------------------------------------------------------------------

   Superseded by the admin-delete-member Edge Function (see supabaseClient.js).
   Two reasons it shouldn't be left sitting in the schema:

   1. It does `delete from auth.users`, which schema-update-3.sql already
      documents as the path hosted Supabase silently no-ops — so it reports
      success and deletes nothing.
   2. The Supabase security advisor flags it as a SECURITY DEFINER function
      that `authenticated` can execute over /rest/v1/rpc/. The is_admin() check
      inside it is correct, so this isn't an active hole — but a superseded,
      callable, silently-succeeding delete is exactly the kind of thing that
      gets re-wired by accident later.

   Nothing in src/ calls it (verified — only comments mention it by name). */
drop function if exists public.admin_delete_member(uuid);


/* ---------------------------------------------------------------------------
   M5 — reports INSERT should require approval
   ---------------------------------------------------------------------------

   Every other member-write path in the app is gated on is_approved():
   messages, posts, comments, events, jobs, businesses. `reports` was the one
   that only checked `reporter_id = auth.uid()`, so an account sitting on the
   pending-verification screen could still POST reports straight at the REST
   API and fill the admin moderation queue.

   Not reachable through the UI — the approval gate in App.jsx sits above the
   router — so this is defence in depth, not a live bug. It costs one line and
   removes the inconsistency.

   (The other half of this finding turned out to be wrong on inspection:
   get_or_create_conversation() already raises 'Account not yet approved' at
   the top. Left alone.) */
drop policy if exists "Members can file reports" on public.reports;
create policy "Members can file reports" on public.reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and (select public.is_approved())
  );
