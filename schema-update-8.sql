-- ============================================================
-- Update 8: admin page (approve members, moderate posts/jobs/events
-- without opening the Supabase dashboard)
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- PROFILES: admin flag ----------
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql security definer set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Make yourself the first admin. Re-running this is harmless — it just
-- re-confirms the same row. To add more admins later, run:
--   update public.profiles set is_admin = true where id = (select id from auth.users where email = '...');
update public.profiles
set is_admin = true
where id = (select id from auth.users where email = 'kyletrompeter0@gmail.com');

-- Admins can update ANY profile (approve/un-approve, promote other admins).
-- This is a second, additive policy alongside "Users can update own profile" —
-- Postgres OR's permissive policies together, so this doesn't loosen what
-- regular members can do to their own row, it only adds a path for admins.
drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Admins need to see *who* is pending — full_name is often still blank at
-- signup (it's only filled in during onboarding), so email is the only
-- reliable way to tell members apart. auth.users isn't exposed to the
-- client directly, so this security-definer function hands back just
-- enough (email + the profile fields the admin page needs) and refuses
-- to run for anyone who isn't an admin.
create or replace function public.admin_list_members()
returns table (
  id uuid,
  email text,
  full_name text,
  grad_year int,
  city text,
  country text,
  approved boolean,
  is_admin boolean,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  -- auth.users.email is `character varying`, not `text` — RETURN QUERY
  -- requires an exact type match against the declared RETURNS TABLE column
  -- (unlike a plain SELECT, it won't implicitly widen varchar to text), so
  -- without this cast Postgres raises "structure of query does not match
  -- function result type" the moment this runs.
  return query
    select p.id, u.email::text, p.full_name, p.grad_year, p.city, p.country, p.approved, p.is_admin, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

grant execute on function public.admin_list_members() to authenticated;

-- ---------- MODERATION: admins can delete anyone's content ----------
drop policy if exists "Admins can delete any post" on public.posts;
create policy "Admins can delete any post"
  on public.posts for delete to authenticated
  using (public.is_admin());

drop policy if exists "Admins can delete any comment" on public.post_comments;
create policy "Admins can delete any comment"
  on public.post_comments for delete to authenticated
  using (public.is_admin());

drop policy if exists "Admins can delete any job" on public.jobs;
create policy "Admins can delete any job"
  on public.jobs for delete to authenticated
  using (public.is_admin());

drop policy if exists "Admins can delete any event" on public.events;
create policy "Admins can delete any event"
  on public.events for delete to authenticated
  using (public.is_admin());

drop policy if exists "Admins can delete any event comment" on public.event_comments;
create policy "Admins can delete any event comment"
  on public.event_comments for delete to authenticated
  using (public.is_admin());
