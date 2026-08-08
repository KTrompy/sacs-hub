-- schema-update-57.sql — signup/login audit fixes (2026-08-05)
--
-- Five separate problems, all found by walking the signup and login flows
-- end to end. See the notes on each block.
--
-- Run order: after schema-update-56.sql.

/* ------------------------------------------------------------------
   1. Real name fields.

   The signup wizard has always asked for first name, preferred first name
   and last name, and then thrown two of the three away: `profiles` only
   ever had `full_name`, so the three inputs were joined into one string
   and the parts survived only in auth.users.raw_user_meta_data, where
   nothing in the app can read them.

   That matters for exactly the thing this site gates on — an admin
   verifying a signup against SACS residence records needs the legal
   first name, which is precisely the one that gets replaced when someone
   fills in "Preferred first name".
   ------------------------------------------------------------------ */
alter table public.profiles
  add column if not exists first_name     text not null default '',
  add column if not exists preferred_name text not null default '',
  add column if not exists last_name      text not null default '';

-- Backfill. Prefer what signup actually captured (it's sitting in
-- user_metadata for everyone who joined through the wizard); fall back to
-- splitting full_name on the first space for older rows and social joiners.
update public.profiles p set
  first_name = coalesce(
    nullif(btrim(u.raw_user_meta_data->>'first_name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'given_name'), ''),
    nullif(split_part(btrim(p.full_name), ' ', 1), ''),
    ''
  ),
  preferred_name = coalesce(
    nullif(btrim(u.raw_user_meta_data->>'preferred_name'), ''),
    ''
  ),
  last_name = coalesce(
    nullif(btrim(u.raw_user_meta_data->>'last_name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'family_name'), ''),
    nullif(btrim(substr(btrim(p.full_name), length(split_part(btrim(p.full_name), ' ', 1)) + 1)), ''),
    ''
  )
from auth.users u
where u.id = p.id
  and (p.first_name = '' and p.last_name = '');


/* ------------------------------------------------------------------
   2. Declined signups.

   An admin could approve or permanently delete, and nothing in between.
   Someone who isn't an Old Boy therefore sat on the "we're verifying
   you" screen indefinitely, being told an answer was coming that never
   would — or got deleted with no explanation and signed straight up
   again, back into the same queue.

   `declined_at` gives that decision somewhere to live, so the person can
   be told plainly (see App.jsx's Declined gate) and the admin can undo it.
   ------------------------------------------------------------------ */
alter table public.profiles
  add column if not exists declined_at     timestamptz,
  add column if not exists declined_reason text not null default '';


/* ------------------------------------------------------------------
   3. Don't let an unconfirmed address be approved.

   handle_new_user writes the profile row — including consented_at, from
   the signup metadata — at the moment auth.users gets its INSERT, which
   is *before* the person has clicked anything in their inbox. So an
   unconfirmed signup looked identical to a confirmed one in the admin
   queue, got approved, and was emailed "you're verified, sign in" — at
   which point sign-in failed with "Email not confirmed" and there was no
   way forward.

   Two live accounts reached that state before this was caught.
   ------------------------------------------------------------------ */
create or replace function public.require_confirmed_email_for_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_confirmed timestamptz;
begin
  if new.approved and not coalesce(old.approved, false) then
    select email_confirmed_at into v_confirmed from auth.users where id = new.id;
    if v_confirmed is null then
      raise exception 'This member has not confirmed their email address yet, so they cannot sign in even once approved. Resend their confirmation email first.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_approval_requires_confirmed_email on public.profiles;
create trigger on_approval_requires_confirmed_email
  before update of approved on public.profiles
  for each row execute function public.require_confirmed_email_for_approval();


/* ------------------------------------------------------------------
   4. Extend the self-escalation guard to cover declined_at.

   `Users can update own profile` is a blanket id = auth.uid() policy, so
   without this a declined member could simply clear their own
   declined_at with a direct PostgREST call and put themselves back in the
   queue. Same reasoning as approved/is_admin, so it goes in the same
   trigger rather than a new one.
   ------------------------------------------------------------------ */
create or replace function public.prevent_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    if new.approved is distinct from old.approved then
      raise exception 'Only an admin can change approval status.';
    end if;
    if new.is_admin is distinct from old.is_admin then
      raise exception 'Only an admin can change admin status.';
    end if;
    if new.declined_at is distinct from old.declined_at then
      raise exception 'Only an admin can change declined status.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_self_privilege_escalation on public.profiles;
create trigger on_self_privilege_escalation
  before update of approved, is_admin, declined_at on public.profiles
  for each row execute function public.prevent_self_privilege_escalation();


/* ------------------------------------------------------------------
   5. handle_new_user writes the name parts too.

   Same trigger as before, with first/preferred/last name added to the
   detail update so a wizard signup lands complete. full_name stays the
   display name and is still composed client-side (preferred name wins
   over first name), so nothing downstream changes.
   ------------------------------------------------------------------ */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
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

  begin
    update public.profiles set
      first_name         = coalesce(nullif(btrim(m->>'first_name'), ''),
                                    nullif(btrim(m->>'given_name'), ''),
                                    first_name),
      preferred_name     = coalesce(nullif(btrim(m->>'preferred_name'), ''), preferred_name),
      last_name          = coalesce(nullif(btrim(m->>'last_name'), ''),
                                    nullif(btrim(m->>'family_name'), ''),
                                    last_name),
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
  raise warning 'handle_new_user failed for % — %', new.id, sqlerrm;
  return new;
end;
$$;


/* ------------------------------------------------------------------
   6. admin_list_members returns what the admin screen now needs.

   email_confirmed_at is the important one: without it the admin panel
   cannot tell the difference between "waiting on your decision" and
   "cannot sign in no matter what you decide", which is the whole of
   problem 3 above.
   ------------------------------------------------------------------ */
drop function if exists public.admin_list_members();
create or replace function public.admin_list_members()
returns table (
  id uuid,
  email text,
  email_confirmed_at timestamptz,
  full_name text,
  first_name text,
  preferred_name text,
  last_name text,
  grad_year int,
  city text,
  country text,
  approved boolean,
  is_admin boolean,
  created_at timestamptz,
  consented_at timestamptz,
  declined_at timestamptz,
  declined_reason text
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  return query
    select p.id, u.email::text, u.email_confirmed_at, p.full_name,
           p.first_name, p.preferred_name, p.last_name,
           p.grad_year, p.city, p.country, p.approved, p.is_admin,
           p.created_at, p.consented_at, p.declined_at, p.declined_reason
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

revoke all on function public.admin_list_members() from public, anon;
grant execute on function public.admin_list_members() to authenticated;


/* ------------------------------------------------------------------
   7. Approving clears a previous decline, and declining clears approval.

   Belt and braces so the two flags can never both be set — the UI does
   this too, but the UI isn't the only thing that writes here (the
   Supabase dashboard is).
   ------------------------------------------------------------------ */
create or replace function public.sync_approval_decline()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.approved and not coalesce(old.approved, false) then
    new.declined_at := null;
    new.declined_reason := '';
  end if;
  if new.declined_at is not null and old.declined_at is null then
    new.approved := false;
  end if;
  return new;
end;
$$;

drop trigger if exists on_approval_decline_sync on public.profiles;
create trigger on_approval_decline_sync
  before update of approved, declined_at on public.profiles
  for each row execute function public.sync_approval_decline();
