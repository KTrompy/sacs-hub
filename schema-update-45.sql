-- ============================================================
-- Update 45: don't let admins approve a member before they've
-- finished signup.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================
--
-- Background: a Google/social signup gets an auth.users row (and, via
-- the handle_new_user trigger, a profiles row) the moment they complete
-- the OAuth redirect — before FinishSignup.jsx has collected their
-- name, years in Eendrag, address, or consent. That row shows up in
-- Admin > Pending approval immediately, indistinguishable from someone
-- who's actually finished signing up, because admin_list_members()
-- never returned consented_at and the "Admins can update any profile"
-- policy never checked it. An admin could hit Approve on a Google
-- signup that never went any further, before the site had collected
-- what it's supposed to collect from every member.
--
-- consented_at is set exactly once, at the end of FinishSignup.jsx
-- (Google path) or the final step of the Auth.jsx signup wizard (email
-- path) — see App.jsx, which routes anyone signed in with a null
-- consented_at to FinishSignup instead of the normal app. It's already
-- the "did this person finish signing up" marker; this just enforces
-- it before approval instead of only using it for routing.

-- ---------- admin_list_members: surface consented_at ----------
-- Postgres won't let CREATE OR REPLACE change a function's return row
-- shape, so the old 9-column version has to go first.
drop function if exists public.admin_list_members();

create function public.admin_list_members()
returns table (
  id uuid,
  email text,
  full_name text,
  grad_year int,
  city text,
  country text,
  approved boolean,
  is_admin boolean,
  created_at timestamptz,
  consented_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  return query
    select p.id, u.email::text, p.full_name, p.grad_year, p.city, p.country, p.approved, p.is_admin, p.created_at, p.consented_at
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

grant execute on function public.admin_list_members() to authenticated;

-- ---------- RLS: block approving an unfinished signup ----------
-- Additive to schema-update-39's self-update guard — this only touches
-- the admin policy. Admins keep full control over every other column;
-- the new clause only fires when the incoming row has approved = true,
-- and in that case requires consented_at to already be set.
drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (
    public.is_admin()
    and (approved = false or consented_at is not null)
  );
