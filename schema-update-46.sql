-- schema-update-46.sql — auth/signup flow hardening (audit 2026-08-01)
--
-- Five things, all stemming from the same finding: the "you can't browse
-- until the committee verifies you" rule lived only in App.jsx, so it was a
-- UI curtain rather than a lock.
--
--   1. Gate every SELECT policy on is_approved() — the actual fix.
--   2. Make handle_new_user do the whole profile insert from user_metadata,
--      and never abort an auth signup if something in it goes wrong.
--   3. Tell admins (via notifications) when someone finishes signing up.
--   4. Stop an admin from being granted to an account that hasn't consented.
--   5. Stop the last admin from being demoted and locking everyone out.

-- ---------------------------------------------------------------------------
-- 1. Read policies now require approval
-- ---------------------------------------------------------------------------
-- Every one of these was `using (true)` for role `authenticated`, so any
-- account with a valid JWT — including one created seconds ago and never
-- verified — could read the whole database straight off the REST API while
-- the app showed it the "pending verification" screen. is_approved() only
-- ever appeared on INSERT policies.
--
-- profiles keeps an `id = auth.uid()` escape hatch: App.jsx, FinishSignup
-- and PendingVerification all have to read the signed-in person's own row
-- precisely while they're still unapproved, so locking that out would break
-- the pending screen itself. Admin.jsx reads members through the
-- admin_list_members SECURITY DEFINER RPC, which is unaffected either way,
-- but is_admin() is included so ad-hoc admin reads keep working.
--
-- badges is deliberately left open — it's a static catalogue of badge
-- definitions with no member data in it.

drop policy if exists "Members can view all profiles" on public.profiles;
create policy "Approved members can view profiles"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_approved() or public.is_admin());

drop policy if exists "Members can read posts" on public.posts;
create policy "Approved members can read posts"
  on public.posts for select to authenticated
  using (public.is_approved() or public.is_admin());

drop policy if exists "Members can read comments" on public.post_comments;
create policy "Approved members can read comments"
  on public.post_comments for select to authenticated
  using (public.is_approved() or public.is_admin());

drop policy if exists "Members can read likes" on public.post_likes;
create policy "Approved members can read likes"
  on public.post_likes for select to authenticated
  using (public.is_approved() or public.is_admin());

drop policy if exists "Members can read jobs" on public.jobs;
create policy "Approved members can read jobs"
  on public.jobs for select to authenticated
  using (public.is_approved() or public.is_admin());

drop policy if exists "Members can read events" on public.events;
create policy "Approved members can read events"
  on public.events for select to authenticated
  using (public.is_approved() or public.is_admin());

drop policy if exists "Members can read event comments" on public.event_comments;
create policy "Approved members can read event comments"
  on public.event_comments for select to authenticated
  using (public.is_approved() or public.is_admin());

drop policy if exists "Members can read rsvps" on public.event_rsvps;
create policy "Approved members can read rsvps"
  on public.event_rsvps for select to authenticated
  using (public.is_approved() or public.is_admin());

drop policy if exists "Members can read businesses" on public.businesses;
create policy "Approved members can read businesses"
  on public.businesses for select to authenticated
  using (public.is_approved() or public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. handle_new_user: complete, idempotent, and non-fatal
-- ---------------------------------------------------------------------------
-- The old version inserted only (id, full_name) with no ON CONFLICT and no
-- exception handling. Two problems:
--
--   * Every other field the signup wizard collected had to be written by a
--     second, client-side .update() in Auth.jsx (line ~344) that runs after
--     sign-in and is skipped entirely if there's no session — which is
--     exactly what happens the moment "Confirm email" is switched on. The
--     details were already being stashed in raw_user_meta_data as a backup;
--     this makes that the primary path, so the client update is now just a
--     redundant safety net rather than the only thing writing the data.
--
--   * A failure here — a future NOT NULL column without a default, a
--     constraint, a transient error — aborts the auth.users insert with it,
--     which takes down signup site-wide with an opaque "Database error
--     saving new user". The minimal insert now happens first and on its own,
--     and everything richer runs in a guarded block that can fail without
--     costing the person their account.
--
-- consented_at is set here only when data_consent is present in the
-- metadata, which Auth.jsx sets when the consent checkbox is ticked on step
-- 3. Social signups have no such flag, so they still land in
-- FinishSignup.jsx to give consent — which is the intended behaviour.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  -- Minimal row first: this must succeed, so it touches nothing that could
  -- realistically reject it.
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(m->>'full_name'), ''),
      nullif(btrim(m->>'name'), ''),
      ''
    )
  )
  on conflict (id) do nothing;

  -- Everything the signup wizard collected. Guarded: a bad value in here
  -- should cost the new member their address, not their account.
  begin
    update public.profiles set
      start_year         = coalesce(nullif(m->>'start_year', '')::int, start_year),
      grad_year          = coalesce(nullif(m->>'grad_year', '')::int, grad_year),
      email_news_opt_in  = coalesce((m->>'email_news_opt_in')::boolean, email_news_opt_in),
      address_line1      = coalesce(nullif(m->>'address_line1', ''), address_line1),
      address_line2      = coalesce(nullif(m->>'address_line2', ''), address_line2),
      address_line3      = coalesce(nullif(m->>'address_line3', ''), address_line3),
      province           = coalesce(nullif(m->>'province', ''), province),
      city               = coalesce(nullif(m->>'city', ''), city),
      postal_code        = coalesce(nullif(m->>'postal_code', ''), postal_code),
      country            = coalesce(nullif(m->>'country', ''), country),
      lat                = coalesce(nullif(m->>'lat', '')::double precision, lat),
      lng                = coalesce(nullif(m->>'lng', '')::double precision, lng),
      -- Only the full wizard sets this; social joiners consent in
      -- FinishSignup.jsx instead.
      consented_at       = case
                             when (m->>'data_consent')::boolean is true then now()
                             else consented_at
                           end
    where id = new.id;
  exception when others then
    raise warning 'handle_new_user: profile detail update failed for % — %', new.id, sqlerrm;
  end;

  return new;
exception when others then
  -- Last resort. Never let profile creation take the signup down with it;
  -- App.jsx now renders a recoverable error screen for a session with no
  -- profile row rather than falling through into the app.
  raise warning 'handle_new_user failed for % — %', new.id, sqlerrm;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Admins get told when someone is waiting
-- ---------------------------------------------------------------------------
-- Nothing notified anyone that a signup had come in — an admin only found
-- out by manually visiting Admin → Pending approval. Meanwhile the new
-- member is looking at a screen promising them an email. The approval email
-- still needs a sending domain (see Admin.jsx's TODO), but this at least
-- closes the loop on the committee's side.
--
-- Fires on the null → not-null transition of consented_at, i.e. the moment
-- someone actually finishes signing up and becomes approvable. Half-finished
-- social signups deliberately don't fire: an admin can't approve them anyway
-- (schema-update-45), so an alert would just be noise.

create or replace function public.notify_admins_new_signup()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.consented_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.consented_at is not null then return new; end if;
  if new.approved then return new; end if;

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  select
    a.id,
    new.id,
    'new_signup',
    'member',
    null,
    coalesce(nullif(btrim(new.full_name), ''), 'Someone new')
      || ' has signed up and is waiting to be verified.'
  from public.profiles a
  where a.is_admin and a.id <> new.id;

  return new;
exception when others then
  -- Same principle as handle_new_user: an alert failing must never break
  -- the signup that triggered it.
  raise warning 'notify_admins_new_signup failed for % — %', new.id, sqlerrm;
  return new;
end;
$function$;

drop trigger if exists on_profile_signup_complete on public.profiles;
create trigger on_profile_signup_complete
  after insert or update of consented_at on public.profiles
  for each row execute function public.notify_admins_new_signup();

-- ---------------------------------------------------------------------------
-- 4. Admin rights can't be granted to an unconsented account
-- ---------------------------------------------------------------------------
-- schema-update-45 stopped admins approving someone who hadn't finished
-- signing up, but left a gap: is_admin wasn't covered by that WITH CHECK, so
-- a half-created account could still be handed the keys.

drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile"
  on public.profiles for update to authenticated
  using (public.is_admin())
  with check (
    public.is_admin()
    and (approved = false or consented_at is not null)
    and (is_admin = false or consented_at is not null)
  );

-- ---------------------------------------------------------------------------
-- 5. The last admin can't be demoted
-- ---------------------------------------------------------------------------
-- Admin.jsx's "Admin" toggle had no floor, so the one admin could switch
-- themselves off and leave nobody able to approve anyone — unrecoverable
-- from inside the app.
--
-- Deletion is already covered: admin_delete_member refuses to delete the
-- caller, so the sole remaining admin can't remove themselves either.

create or replace function public.prevent_last_admin_demotion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.is_admin and not new.is_admin then
    if (select count(*) from public.profiles where is_admin) <= 1 then
      raise exception 'This is the only admin account — promote someone else before removing admin rights.';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists on_admin_demotion on public.profiles;
create trigger on_admin_demotion
  before update of is_admin on public.profiles
  for each row execute function public.prevent_last_admin_demotion();
