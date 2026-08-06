-- ============================================================
-- SACS Alumni Hub — full schema bootstrap
-- Generated 2026-08-06T08:56:40Z
-- Paste this entire file into Supabase SQL Editor and hit Run.
-- Contains schema-update-0 (baseline) through schema-update-57.
-- Number 55 was never used and is skipped.
-- Safe to re-run — every DDL uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- ============================================================


-- ============================================================
-- Migration 0  (schema-update-0.sql)
-- ============================================================
-- ============================================================
-- Update 0: Baseline (tables, functions and triggers that the Eendrag
--                    project set up via the Supabase Dashboard on day one
--                    and were never captured as SQL).
--
-- Every subsequent migration (schema-update-1 onwards) assumes these
-- exist. Safe to re-run: everything uses IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================

-- ---------- Tables ----------

-- Minimum profiles table that later migrations will extend.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null default '',
  grad_year    integer,
  section      text,
  occupation   text default '',
  city         text default '',
  bio          text default '',
  approved     boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- posts / conversations / conversation_participants / messages: created
-- by the Dashboard originally, then only ALTERed by later migrations.
create table if not exists public.posts (
  id          bigint primary key generated always as identity,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  content     text not null check (char_length(content) between 1 and 4000),
  created_at  timestamptz not null default now(),
  title       text default '',
  image_urls  text[] default '{}',
  video_url   text,
  updated_at  timestamptz,
  pinned      boolean not null default false
);
alter table public.posts enable row level security;

create table if not exists public.conversations (
  id          bigint primary key generated always as identity,
  created_at  timestamptz not null default now()
);
alter table public.conversations enable row level security;

create table if not exists public.conversation_participants (
  conversation_id bigint not null references public.conversations(id) on delete cascade,
  user_id         uuid   not null references public.profiles(id)       on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.conversation_participants enable row level security;

create table if not exists public.messages (
  id              bigint primary key generated always as identity,
  conversation_id bigint not null references public.conversations(id) on delete cascade,
  sender_id       uuid   not null references public.profiles(id)      on delete cascade,
  content         text not null,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  constraint messages_content_length_or_deleted check (
    deleted_at is not null
    or (char_length(content) between 1 and 4000)
  )
);
alter table public.messages enable row level security;

-- ---------- Baseline RLS on profiles ----------

drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------- Helper functions used by later migrations' RLS ----------

-- `is_approved` was Dashboard-only on Eendrag; baseline here.
-- `is_admin` is CREATE OR REPLACEd by a later migration; the plpgsql stub
-- below tolerates the column not existing until then.
-- `is_participant` is first CALLED in mig 29 but not CREATED until mig 51.

create or replace function public.is_approved()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v boolean;
begin
  select approved into v from public.profiles where id = auth.uid();
  return coalesce(v, false);
exception when undefined_column then
  return false;
end;
$$;

create or replace function public.is_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v boolean;
begin
  select is_admin into v from public.profiles where id = auth.uid();
  return coalesce(v, false);
exception when undefined_column then
  return false;
end;
$$;

create or replace function public.is_participant(conv_id bigint, uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select uid = (select auth.uid()) and exists (
    select 1 from public.conversation_participants
    where conversation_id = conv_id and user_id = uid
  );
$$;

-- ---------- handle_new_user function + auth trigger ----------

-- Stub — later migrations (15, 45, 46, 47, 49, 53, 57) CREATE OR REPLACE
-- with the full-fat version that also copies address/city/consent metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
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
  return new;
exception when others then
  raise warning 'handle_new_user (baseline) failed for % — %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================
-- Migration 1  (schema-update-1.sql)
-- ============================================================
-- ============================================================
-- Update 1: company field + profile photos
-- Run this in Supabase SQL Editor (your existing data is untouched)
-- ============================================================

-- New profile columns
alter table public.profiles add column if not exists company text default '';
alter table public.profiles add column if not exists avatar_url text default '';

-- Storage bucket for profile photos (public read so <img> tags work)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Members can upload/replace only their own photo (path must start with their user id)
create policy "Users can upload own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Anyone can view avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');


-- ============================================================
-- Migration 2  (schema-update-2.sql)
-- ============================================================
-- ============================================================
-- Update 2: profile fields, feed upgrades, events, jobs
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- PROFILES: new fields ----------
alter table public.profiles add column if not exists industry text default '';
alter table public.profiles add column if not exists occupation_description text default '';
alter table public.profiles add column if not exists available_for_mentorship boolean default false;
alter table public.profiles add column if not exists mentorship_description text default '';
alter table public.profiles add column if not exists linkedin_url text default '';
alter table public.profiles add column if not exists country text default 'South Africa';
alter table public.profiles add column if not exists province text default '';
-- Are they still living in Eendrag right now (current student) vs alumnus?
alter table public.profiles add column if not exists is_current_resident boolean default false;

-- ---------- POSTS: title + images ----------
alter table public.posts add column if not exists title text default '';
alter table public.posts add column if not exists image_urls text[] default '{}';

-- ---------- POST LIKES ----------
create table if not exists public.post_likes (
  post_id bigint not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.post_likes enable row level security;

drop policy if exists "Members can read likes" on public.post_likes;
create policy "Members can read likes"
  on public.post_likes for select to authenticated using (true);

drop policy if exists "Approved members can like" on public.post_likes;
create policy "Approved members can like"
  on public.post_likes for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists "Users can unlike" on public.post_likes;
create policy "Users can unlike"
  on public.post_likes for delete to authenticated
  using (user_id = auth.uid());

-- ---------- POST COMMENTS ----------
create table if not exists public.post_comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.post_comments enable row level security;

drop policy if exists "Members can read comments" on public.post_comments;
create policy "Members can read comments"
  on public.post_comments for select to authenticated using (true);

drop policy if exists "Approved members can comment" on public.post_comments;
create policy "Approved members can comment"
  on public.post_comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_approved());

drop policy if exists "Authors can delete own comments" on public.post_comments;
create policy "Authors can delete own comments"
  on public.post_comments for delete to authenticated
  using (author_id = auth.uid());

-- ---------- EVENTS ----------
create table if not exists public.events (
  id bigint generated always as identity primary key,
  title text not null,
  description text default '',
  event_date timestamptz not null,
  location text default '',
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;

drop policy if exists "Members can read events" on public.events;
create policy "Members can read events"
  on public.events for select to authenticated using (true);

drop policy if exists "Approved members can create events" on public.events;
create policy "Approved members can create events"
  on public.events for insert to authenticated
  with check (created_by = auth.uid() and public.is_approved());

drop policy if exists "Creators can delete own events" on public.events;
create policy "Creators can delete own events"
  on public.events for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists "Creators can update own events" on public.events;
create policy "Creators can update own events"
  on public.events for update to authenticated
  using (created_by = auth.uid());

-- ---------- JOBS ----------
create table if not exists public.jobs (
  id bigint generated always as identity primary key,
  title text not null,
  company text not null,
  location text default '',
  employment_type text default '',   -- Full-time / Internship / Contract / etc.
  description text not null,
  apply_url text default '',
  contact_email text default '',
  posted_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.jobs enable row level security;

drop policy if exists "Members can read jobs" on public.jobs;
create policy "Members can read jobs"
  on public.jobs for select to authenticated using (true);

drop policy if exists "Approved members can post jobs" on public.jobs;
create policy "Approved members can post jobs"
  on public.jobs for insert to authenticated
  with check (posted_by = auth.uid() and public.is_approved());

drop policy if exists "Posters can delete own jobs" on public.jobs;
create policy "Posters can delete own jobs"
  on public.jobs for delete to authenticated
  using (posted_by = auth.uid());

-- ---------- POST IMAGES STORAGE ----------
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload post images" on storage.objects;
create policy "Approved members can upload post images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view post images" on storage.objects;
create policy "Anyone can view post images"
  on storage.objects for select
  using (bucket_id = 'post-images');

drop policy if exists "Users can delete own post images" on storage.objects;
create policy "Users can delete own post images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- REALTIME ----------
-- Wrap in DO block so re-runs don't error if table is already in the publication
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'post_likes';
  if not found then alter publication supabase_realtime add table public.post_likes; end if;

  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'post_comments';
  if not found then alter publication supabase_realtime add table public.post_comments; end if;

  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'events';
  if not found then alter publication supabase_realtime add table public.events; end if;

  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'jobs';
  if not found then alter publication supabase_realtime add table public.jobs; end if;
end $$;


-- ============================================================
-- Migration 3  (schema-update-3.sql)
-- ============================================================
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


-- ============================================================
-- Migration 4  (schema-update-4.sql)
-- ============================================================
-- ============================================================
-- Update 4: degree field, event RSVPs, event comments
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- PROFILES: degree studied ----------
alter table public.profiles add column if not exists degree text default '';

-- ---------- EVENT RSVPS ----------
create table if not exists public.event_rsvps (
  event_id bigint not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.event_rsvps enable row level security;

drop policy if exists "Members can read rsvps" on public.event_rsvps;
create policy "Members can read rsvps"
  on public.event_rsvps for select to authenticated using (true);

drop policy if exists "Approved members can rsvp" on public.event_rsvps;
create policy "Approved members can rsvp"
  on public.event_rsvps for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists "Users can cancel own rsvp" on public.event_rsvps;
create policy "Users can cancel own rsvp"
  on public.event_rsvps for delete to authenticated
  using (user_id = auth.uid());

-- ---------- EVENT COMMENTS ----------
create table if not exists public.event_comments (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.event_comments enable row level security;

drop policy if exists "Members can read event comments" on public.event_comments;
create policy "Members can read event comments"
  on public.event_comments for select to authenticated using (true);

drop policy if exists "Approved members can comment on events" on public.event_comments;
create policy "Approved members can comment on events"
  on public.event_comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_approved());

drop policy if exists "Authors can delete own event comments" on public.event_comments;
create policy "Authors can delete own event comments"
  on public.event_comments for delete to authenticated
  using (author_id = auth.uid());

-- ---------- REALTIME ----------
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'event_rsvps';
  if not found then alter publication supabase_realtime add table public.event_rsvps; end if;

  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'event_comments';
  if not found then alter publication supabase_realtime add table public.event_comments; end if;
end $$;


-- ============================================================
-- Migration 5  (schema-update-5.sql)
-- ============================================================
-- ============================================================
-- Update 5: coordinates for the alumni map
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- Latitude/longitude for the city on each profile, filled in automatically
-- (client-side, via OpenStreetMap's free Nominatim geocoder) whenever a
-- member saves their profile with a new city/country. Nullable — plenty of
-- profiles won't have it yet, and the map just skips those.
alter table public.profiles add column if not exists lat double precision;
alter table public.profiles add column if not exists lng double precision;

-- No new RLS policies needed: lat/lng ride along on the existing
-- "Users can update own profile" / "Members can view all profiles" policies.


-- ============================================================
-- Migration 6  (schema-update-6.sql)
-- ============================================================
-- ============================================================
-- Update 6: read-tracking for messages (powers the floating
-- inbox's unread badge, LinkedIn-style)
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.conversation_participants
  add column if not exists last_read_at timestamptz not null default now();

-- How many unread messages does the current user have, across every
-- conversation they're part of? Security definer so the client can call it
-- directly without extra RLS plumbing (same pattern as get_or_create_conversation).
create or replace function public.unread_message_count()
returns bigint
language sql security definer set search_path = public
as $$
  select count(*)::bigint
  from public.messages m
  join public.conversation_participants cp
    on cp.conversation_id = m.conversation_id
   and cp.user_id = auth.uid()
  where m.sender_id <> auth.uid()
    and m.created_at > cp.last_read_at;
$$;

-- Called when the current user opens a conversation in the floating inbox,
-- so its messages stop counting toward their unread badge.
create or replace function public.mark_conversation_read(conv_id bigint)
returns void
language sql security definer set search_path = public
as $$
  update public.conversation_participants
  set last_read_at = now()
  where conversation_id = conv_id and user_id = auth.uid();
$$;


-- ============================================================
-- Migration 7  (schema-update-7.sql)
-- ============================================================
-- ============================================================
-- Update 7: video posts (replaces "Write article" quick-action
-- in the Feed composer with "Add video" — a pasted YouTube/Vimeo
-- link, embedded in the post)
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.posts
  add column if not exists video_url text;


-- ============================================================
-- Migration 8  (schema-update-8.sql)
-- ============================================================
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


-- ============================================================
-- Migration 9  (schema-update-9.sql)
-- ============================================================
-- ============================================================
-- Update 9: editing posts/jobs, job listing logos, and an in-app
-- notification bell.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- EDITING: posts ----------
alter table public.posts add column if not exists updated_at timestamptz;

drop policy if exists "Authors can update own posts" on public.posts;
create policy "Authors can update own posts"
  on public.posts for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- ---------- EDITING: jobs ----------
alter table public.jobs add column if not exists updated_at timestamptz;
alter table public.jobs add column if not exists logo_url text default '';

drop policy if exists "Posters can update own jobs" on public.jobs;
create policy "Posters can update own jobs"
  on public.jobs for update to authenticated
  using (posted_by = auth.uid())
  with check (posted_by = auth.uid());

-- ---------- JOB LOGOS STORAGE ----------
insert into storage.buckets (id, name, public)
values ('job-logos', 'job-logos', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload job logos" on storage.objects;
create policy "Approved members can upload job logos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'job-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view job logos" on storage.objects;
create policy "Anyone can view job logos"
  on storage.objects for select
  using (bucket_id = 'job-logos');

drop policy if exists "Users can replace own job logos" on storage.objects;
create policy "Users can replace own job logos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'job-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own job logos" on storage.objects;
create policy "Users can delete own job logos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'job-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- EDITING: events ----------
-- "Creators can update own events" already exists (schema-update-2.sql) —
-- just add the same updated_at column for a consistent "edited" indicator.
alter table public.events add column if not exists updated_at timestamptz;

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,   -- recipient
  actor_id uuid references public.profiles(id) on delete set null,          -- who caused it
  type text not null,             -- 'like' | 'comment' | 'event_rsvp' | 'event_comment' | 'message'
  entity_type text not null,      -- 'post' | 'event' | 'conversation'
  entity_id bigint,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- Only the read flag should ever change from the client, and only on your own rows.
drop policy if exists "Users can mark own notifications read" on public.notifications;
create policy "Users can mark own notifications read"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No insert/delete policy for authenticated users on purpose — all rows are
-- created by the security-definer trigger functions below, which run with
-- elevated privileges and bypass RLS, the same pattern used by is_admin().

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read, created_at desc);

-- ---------- Trigger: someone likes your post ----------
create or replace function public.notify_post_like()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_author uuid;
  v_actor_name text;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is null or v_author = new.user_id then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_author, new.user_id, 'like', 'post', new.post_id,
          coalesce(v_actor_name, 'Someone') || ' liked your post');
  return new;
end;
$$;

drop trigger if exists trg_notify_post_like on public.post_likes;
create trigger trg_notify_post_like
  after insert on public.post_likes
  for each row execute function public.notify_post_like();

-- ---------- Trigger: someone comments on your post ----------
create or replace function public.notify_post_comment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_author uuid;
  v_actor_name text;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is null or v_author = new.author_id then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.author_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_author, new.author_id, 'comment', 'post', new.post_id,
          coalesce(v_actor_name, 'Someone') || ' commented on your post');
  return new;
end;
$$;

drop trigger if exists trg_notify_post_comment on public.post_comments;
create trigger trg_notify_post_comment
  after insert on public.post_comments
  for each row execute function public.notify_post_comment();

-- ---------- Trigger: someone RSVPs to your event ----------
create or replace function public.notify_event_rsvp()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid;
  v_title text;
  v_actor_name text;
begin
  select created_by, title into v_creator, v_title from public.events where id = new.event_id;
  if v_creator is null or v_creator = new.user_id then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_creator, new.user_id, 'event_rsvp', 'event', new.event_id,
          coalesce(v_actor_name, 'Someone') || ' is going to ' || coalesce(v_title, 'your event'));
  return new;
end;
$$;

drop trigger if exists trg_notify_event_rsvp on public.event_rsvps;
create trigger trg_notify_event_rsvp
  after insert on public.event_rsvps
  for each row execute function public.notify_event_rsvp();

-- ---------- Trigger: someone comments on your event ----------
create or replace function public.notify_event_comment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid;
  v_title text;
  v_actor_name text;
begin
  select created_by, title into v_creator, v_title from public.events where id = new.event_id;
  if v_creator is null or v_creator = new.author_id then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.author_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_creator, new.author_id, 'event_comment', 'event', new.event_id,
          coalesce(v_actor_name, 'Someone') || ' commented on ' || coalesce(v_title, 'your event'));
  return new;
end;
$$;

drop trigger if exists trg_notify_event_comment on public.event_comments;
create trigger trg_notify_event_comment
  after insert on public.event_comments
  for each row execute function public.notify_event_comment();

-- ---------- Trigger: someone sends you a DM ----------
create or replace function public.notify_new_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_recipient uuid;
  v_actor_name text;
begin
  select user_id into v_recipient
  from public.conversation_participants
  where conversation_id = new.conversation_id and user_id != new.sender_id
  limit 1;
  if v_recipient is null then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.sender_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_recipient, new.sender_id, 'message', 'conversation', new.conversation_id,
          coalesce(v_actor_name, 'Someone') || ' sent you a message');
  return new;
end;
$$;

drop trigger if exists trg_notify_new_message on public.messages;
create trigger trg_notify_new_message
  after insert on public.messages
  for each row execute function public.notify_new_message();

-- ---------- REALTIME ----------
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications';
  if not found then alter publication supabase_realtime add table public.notifications; end if;
end $$;


-- ============================================================
-- Migration 10  (schema-update-10.sql)
-- ============================================================
-- ============================================================
-- Update 10: saved/bookmarked jobs and events
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.saved_jobs (
  job_id bigint not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (job_id, user_id)
);

alter table public.saved_jobs enable row level security;

drop policy if exists "Users can read own saved jobs" on public.saved_jobs;
create policy "Users can read own saved jobs"
  on public.saved_jobs for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can save jobs" on public.saved_jobs;
create policy "Users can save jobs"
  on public.saved_jobs for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can unsave jobs" on public.saved_jobs;
create policy "Users can unsave jobs"
  on public.saved_jobs for delete to authenticated
  using (user_id = auth.uid());

create table if not exists public.saved_events (
  event_id bigint not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.saved_events enable row level security;

drop policy if exists "Users can read own saved events" on public.saved_events;
create policy "Users can read own saved events"
  on public.saved_events for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can save events" on public.saved_events;
create policy "Users can save events"
  on public.saved_events for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can unsave events" on public.saved_events;
create policy "Users can unsave events"
  on public.saved_events for delete to authenticated
  using (user_id = auth.uid());


-- ============================================================
-- Migration 11  (schema-update-11.sql)
-- ============================================================
-- ============================================================
-- Update 11: remove the mentorship feature
-- Run this in Supabase SQL Editor. Safe to re-run.
-- The app no longer reads or writes these columns (see the "no more
-- mentoring feature" change across Directory/Profile/Onboarding/etc.) —
-- this drops them from the database too. This is destructive: any
-- mentorship data on existing profiles is permanently deleted once you
-- run this.
-- ============================================================

alter table public.profiles drop column if exists available_for_mentorship;
alter table public.profiles drop column if exists mentorship_description;


-- ============================================================
-- Migration 12  (schema-update-12.sql)
-- ============================================================
-- ============================================================
-- Update 12: Add business profile fields
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.profiles
add column if not exists expertise text default '',
add column if not exists services_offered text[] default array[]::text[],
add column if not exists business_website text default '',
add column if not exists looking_to_connect text[] default array[]::text[],
add column if not exists business_categories text[] default array[]::text[];


-- ============================================================
-- Migration 13  (schema-update-13.sql)
-- ============================================================
-- ============================================================
-- Update 13: Make "expertise" multi-select (text -> text[])
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Main area of expertise used to be a single value; the profile UI now
-- lets people pick several, scoped to their chosen industry. This
-- converts the column to an array, wrapping any existing single value
-- into a one-item array so no data is lost.
-- ============================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'expertise'
      and data_type <> 'ARRAY'
  ) then
    alter table public.profiles
      alter column expertise drop default;

    alter table public.profiles
      alter column expertise type text[]
      using case
        when expertise is null or expertise = '' then array[]::text[]
        else array[expertise]
      end;

    alter table public.profiles
      alter column expertise set default array[]::text[];
  end if;
end $$;


-- ============================================================
-- Migration 14  (schema-update-14.sql)
-- ============================================================
-- ============================================================
-- Update 14: pinned posts on the Feed page.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.posts add column if not exists pinned boolean not null default false;

-- Admins can update ANY post (to pin/unpin it) — additive alongside
-- "Authors can update own posts" (schema-update-9.sql). Postgres OR's
-- permissive policies together, so this doesn't loosen what authors can do
-- to their own posts, it only adds a path for admins to flip `pinned` on
-- someone else's post. Same pattern as "Admins can update any profile" in
-- schema-update-8.sql.
drop policy if exists "Admins can update any post" on public.posts;
create policy "Admins can update any post"
  on public.posts for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Pinned posts are rare and always fetched in their own small query
-- (see Feed.jsx) — this keeps that lookup cheap regardless of table size.
create index if not exists posts_pinned_idx on public.posts (pinned) where pinned;


-- ============================================================
-- Migration 15  (schema-update-15.sql)
-- ============================================================
-- ============================================================
-- Update 15: Groups — browse/join groups, a per-group feed (its own
-- posts/likes/comments), and a Members tab.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- GROUPS ----------
create table if not exists public.groups (
  id bigint generated always as identity primary key,
  name text not null,
  description text not null default '',
  cover_image_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.groups enable row level security;

-- ---------- GROUP MEMBERS ----------
create table if not exists public.group_members (
  group_id bigint not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',  -- 'member' | 'admin'
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_members enable row level security;

-- Helpers (security definer — same recursion-avoidance trick as
-- is_participant() for conversations in schema.sql) so group_posts/likes/
-- comments RLS can check membership without a policy on group_members
-- having to query group_members itself.
create or replace function public.is_group_member(gid bigint, uid uuid)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_members where group_id = gid and user_id = uid
  );
$$;

create or replace function public.is_group_admin(gid bigint, uid uuid)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_members where group_id = gid and user_id = uid and role = 'admin'
  );
$$;

-- Groups policies: every approved member can see every group (so there's
-- something to discover/join), and can create a new one. Only that group's
-- own admins (or a site admin) can edit/delete it.
drop policy if exists "Members can read groups" on public.groups;
create policy "Members can read groups"
  on public.groups for select to authenticated using (true);

drop policy if exists "Approved members can create groups" on public.groups;
create policy "Approved members can create groups"
  on public.groups for insert to authenticated
  with check (created_by = auth.uid() and public.is_approved());

drop policy if exists "Group admins can update their group" on public.groups;
create policy "Group admins can update their group"
  on public.groups for update to authenticated
  using (public.is_group_admin(id, auth.uid()))
  with check (public.is_group_admin(id, auth.uid()));

drop policy if exists "Group admins can delete their group" on public.groups;
create policy "Group admins can delete their group"
  on public.groups for delete to authenticated
  using (public.is_group_admin(id, auth.uid()));

drop policy if exists "Site admins can delete any group" on public.groups;
create policy "Site admins can delete any group"
  on public.groups for delete to authenticated
  using (public.is_admin());

-- Group membership policies: anyone can see who's in a group (member
-- counts, the Members tab); any approved member can join themselves or
-- leave; a group admin can remove others or change roles.
drop policy if exists "Members can read group membership" on public.group_members;
create policy "Members can read group membership"
  on public.group_members for select to authenticated using (true);

drop policy if exists "Approved members can join a group" on public.group_members;
create policy "Approved members can join a group"
  on public.group_members for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists "Members can leave a group" on public.group_members;
create policy "Members can leave a group"
  on public.group_members for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "Group admins can remove members" on public.group_members;
create policy "Group admins can remove members"
  on public.group_members for delete to authenticated
  using (public.is_group_admin(group_id, auth.uid()));

drop policy if exists "Group admins can change member roles" on public.group_members;
create policy "Group admins can change member roles"
  on public.group_members for update to authenticated
  using (public.is_group_admin(group_id, auth.uid()))
  with check (public.is_group_admin(group_id, auth.uid()));

-- Whoever creates a group is auto-added as its first admin — otherwise a
-- brand new group would start with zero members and nobody able to manage
-- it (only a group admin can add members, but there'd be no admin yet).
create or replace function public.handle_new_group()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'admin')
  on conflict (group_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_new_group_admin on public.groups;
create trigger trg_new_group_admin
  after insert on public.groups
  for each row execute function public.handle_new_group();

-- ---------- GROUP POSTS (each group has its own mini feed) ----------
create table if not exists public.group_posts (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text default '',
  content text not null default '',
  image_urls text[] not null default array[]::text[],
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table public.group_posts enable row level security;

drop policy if exists "Group members can read group posts" on public.group_posts;
create policy "Group members can read group posts"
  on public.group_posts for select to authenticated
  using (public.is_group_member(group_id, auth.uid()));

drop policy if exists "Group members can post" on public.group_posts;
create policy "Group members can post"
  on public.group_posts for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.is_group_member(group_id, auth.uid())
    and public.is_approved()
  );

drop policy if exists "Authors can update own group posts" on public.group_posts;
create policy "Authors can update own group posts"
  on public.group_posts for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "Group admins can update any group post" on public.group_posts;
create policy "Group admins can update any group post"
  on public.group_posts for update to authenticated
  using (public.is_group_admin(group_id, auth.uid()))
  with check (public.is_group_admin(group_id, auth.uid()));

drop policy if exists "Authors can delete own group posts" on public.group_posts;
create policy "Authors can delete own group posts"
  on public.group_posts for delete to authenticated
  using (author_id = auth.uid());

drop policy if exists "Group admins can delete any group post" on public.group_posts;
create policy "Group admins can delete any group post"
  on public.group_posts for delete to authenticated
  using (public.is_group_admin(group_id, auth.uid()));

drop policy if exists "Site admins can delete any group post" on public.group_posts;
create policy "Site admins can delete any group post"
  on public.group_posts for delete to authenticated
  using (public.is_admin());

-- ---------- GROUP POST LIKES ----------
create table if not exists public.group_post_likes (
  post_id bigint not null references public.group_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.group_post_likes enable row level security;

drop policy if exists "Group members can read group post likes" on public.group_post_likes;
create policy "Group members can read group post likes"
  on public.group_post_likes for select to authenticated
  using (exists (
    select 1 from public.group_posts gp
    where gp.id = post_id and public.is_group_member(gp.group_id, auth.uid())
  ));

drop policy if exists "Group members can like group posts" on public.group_post_likes;
create policy "Group members can like group posts"
  on public.group_post_likes for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_approved()
    and exists (
      select 1 from public.group_posts gp
      where gp.id = post_id and public.is_group_member(gp.group_id, auth.uid())
    )
  );

drop policy if exists "Users can unlike group posts" on public.group_post_likes;
create policy "Users can unlike group posts"
  on public.group_post_likes for delete to authenticated
  using (user_id = auth.uid());

-- ---------- GROUP POST COMMENTS ----------
create table if not exists public.group_post_comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.group_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.group_post_comments enable row level security;

drop policy if exists "Group members can read group post comments" on public.group_post_comments;
create policy "Group members can read group post comments"
  on public.group_post_comments for select to authenticated
  using (exists (
    select 1 from public.group_posts gp
    where gp.id = post_id and public.is_group_member(gp.group_id, auth.uid())
  ));

drop policy if exists "Group members can comment" on public.group_post_comments;
create policy "Group members can comment"
  on public.group_post_comments for insert to authenticated
  with check (
    author_id = auth.uid() and public.is_approved()
    and exists (
      select 1 from public.group_posts gp
      where gp.id = post_id and public.is_group_member(gp.group_id, auth.uid())
    )
  );

drop policy if exists "Authors can delete own group post comments" on public.group_post_comments;
create policy "Authors can delete own group post comments"
  on public.group_post_comments for delete to authenticated
  using (author_id = auth.uid());

drop policy if exists "Group admins can delete any group post comment" on public.group_post_comments;
create policy "Group admins can delete any group post comment"
  on public.group_post_comments for delete to authenticated
  using (exists (
    select 1 from public.group_posts gp
    where gp.id = post_id and public.is_group_admin(gp.group_id, auth.uid())
  ));

drop policy if exists "Site admins can delete any group post comment" on public.group_post_comments;
create policy "Site admins can delete any group post comment"
  on public.group_post_comments for delete to authenticated
  using (public.is_admin());

-- ---------- STORAGE: group cover images + group post images ----------
insert into storage.buckets (id, name, public)
values ('group-covers', 'group-covers', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload group covers" on storage.objects;
create policy "Approved members can upload group covers"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'group-covers' and public.is_approved());

drop policy if exists "Anyone can view group covers" on storage.objects;
create policy "Anyone can view group covers"
  on storage.objects for select using (bucket_id = 'group-covers');

drop policy if exists "Uploaders can replace group covers" on storage.objects;
create policy "Uploaders can replace group covers"
  on storage.objects for update to authenticated
  using (bucket_id = 'group-covers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Uploaders can delete group covers" on storage.objects;
create policy "Uploaders can delete group covers"
  on storage.objects for delete to authenticated
  using (bucket_id = 'group-covers' and (storage.foldername(name))[1] = auth.uid()::text);

insert into storage.buckets (id, name, public)
values ('group-post-images', 'group-post-images', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload group post images" on storage.objects;
create policy "Approved members can upload group post images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'group-post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view group post images" on storage.objects;
create policy "Anyone can view group post images"
  on storage.objects for select using (bucket_id = 'group-post-images');

drop policy if exists "Users can delete own group post images" on storage.objects;
create policy "Users can delete own group post images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'group-post-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- REALTIME ----------
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_posts';
  if not found then alter publication supabase_realtime add table public.group_posts; end if;
end $$;
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_members';
  if not found then alter publication supabase_realtime add table public.group_members; end if;
end $$;


-- ============================================================
-- Migration 16  (schema-update-16.sql)
-- ============================================================
-- ============================================================
-- Update 16: Photos — shared albums the whole house can browse and add to.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.photo_albums (
  id bigint generated always as identity primary key,
  title text not null,
  description text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.photo_albums enable row level security;

create table if not exists public.photos (
  id bigint generated always as identity primary key,
  album_id bigint not null references public.photo_albums(id) on delete cascade,
  url text not null,
  caption text default '',
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.photos enable row level security;

-- Albums: every approved member can see and create albums, and can edit/
-- delete an album they created. Site admins can moderate any album.
drop policy if exists "Members can read albums" on public.photo_albums;
create policy "Members can read albums"
  on public.photo_albums for select to authenticated using (true);

drop policy if exists "Approved members can create albums" on public.photo_albums;
create policy "Approved members can create albums"
  on public.photo_albums for insert to authenticated
  with check (created_by = auth.uid() and public.is_approved());

drop policy if exists "Creators can update own albums" on public.photo_albums;
create policy "Creators can update own albums"
  on public.photo_albums for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "Creators can delete own albums" on public.photo_albums;
create policy "Creators can delete own albums"
  on public.photo_albums for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists "Site admins can delete any album" on public.photo_albums;
create policy "Site admins can delete any album"
  on public.photo_albums for delete to authenticated
  using (public.is_admin());

-- Photos: every approved member can see all photos and add photos to any
-- album (a shared album is meant to be added to by everyone, like the
-- reference's "Campus Life" album) — but can only remove photos they
-- personally uploaded (plus the album's creator and site admins, who can
-- clean up anything in/under their own album).
drop policy if exists "Members can read photos" on public.photos;
create policy "Members can read photos"
  on public.photos for select to authenticated using (true);

drop policy if exists "Approved members can add photos" on public.photos;
create policy "Approved members can add photos"
  on public.photos for insert to authenticated
  with check (uploaded_by = auth.uid() and public.is_approved());

drop policy if exists "Uploaders can delete own photos" on public.photos;
create policy "Uploaders can delete own photos"
  on public.photos for delete to authenticated
  using (uploaded_by = auth.uid());

drop policy if exists "Album creators can delete photos in their album" on public.photos;
create policy "Album creators can delete photos in their album"
  on public.photos for delete to authenticated
  using (exists (
    select 1 from public.photo_albums a where a.id = album_id and a.created_by = auth.uid()
  ));

drop policy if exists "Site admins can delete any photo" on public.photos;
create policy "Site admins can delete any photo"
  on public.photos for delete to authenticated
  using (public.is_admin());

-- ---------- STORAGE: album photos ----------
insert into storage.buckets (id, name, public)
values ('album-photos', 'album-photos', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload album photos" on storage.objects;
create policy "Approved members can upload album photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'album-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view album photos" on storage.objects;
create policy "Anyone can view album photos"
  on storage.objects for select using (bucket_id = 'album-photos');

drop policy if exists "Users can delete own album photo files" on storage.objects;
create policy "Users can delete own album photo files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create index if not exists photos_album_idx on public.photos (album_id, created_at desc);


-- ============================================================
-- Migration 17  (schema-update-17.sql)
-- ============================================================
-- ============================================================
-- Update 17: last_seen heartbeat — powers the "Recently online" sort and
-- the green online dot in the Eendragters directory.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.profiles add column if not exists last_seen timestamptz;

-- Already covered by the existing "Users can update own profile" policy
-- (id = auth.uid(), and the with-check only pins `approved` to its current
-- value — it doesn't restrict which other columns change), so no new RLS
-- policy is needed for the app to update its own last_seen on a heartbeat.

create index if not exists profiles_last_seen_idx on public.profiles (last_seen desc);


-- ============================================================
-- Migration 18  (schema-update-18.sql)
-- ============================================================
-- ============================================================
-- Update 18: Mentoring — programs, mentor/mentee sign-up, and a real
-- request/accept matching flow (not just an admin-only pairing tool).
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.mentoring_programs (
  id bigint generated always as identity primary key,
  title text not null,
  description text not null default '',
  owner_id uuid references public.profiles(id) on delete set null,
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now()
);
alter table public.mentoring_programs enable row level security;

create table if not exists public.mentoring_participants (
  program_id bigint not null references public.mentoring_programs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('mentor', 'mentee')),
  capacity int not null default 1,   -- mentors only: how many mentees they're open to
  notes text not null default '',
  created_at timestamptz not null default now(),
  primary key (program_id, user_id)
);
alter table public.mentoring_participants enable row level security;

create table if not exists public.mentoring_matches (
  id bigint generated always as identity primary key,
  program_id bigint not null references public.mentoring_programs(id) on delete cascade,
  mentor_id uuid not null references public.profiles(id) on delete cascade,
  mentee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'completed')),
  requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (program_id, mentor_id, mentee_id)
);
alter table public.mentoring_matches enable row level security;

create or replace function public.is_mentoring_program_owner(pid bigint, uid uuid)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.mentoring_programs where id = pid and owner_id = uid
  );
$$;

-- ---------- Programs ----------
drop policy if exists "Members can read mentoring programs" on public.mentoring_programs;
create policy "Members can read mentoring programs"
  on public.mentoring_programs for select to authenticated using (true);

drop policy if exists "Approved members can create programs" on public.mentoring_programs;
create policy "Approved members can create programs"
  on public.mentoring_programs for insert to authenticated
  with check (owner_id = auth.uid() and public.is_approved());

drop policy if exists "Owners can update their program" on public.mentoring_programs;
create policy "Owners can update their program"
  on public.mentoring_programs for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists "Owners can delete their program" on public.mentoring_programs;
create policy "Owners can delete their program"
  on public.mentoring_programs for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- ---------- Participants (sign up as mentor/mentee) ----------
drop policy if exists "Members can read participants" on public.mentoring_participants;
create policy "Members can read participants"
  on public.mentoring_participants for select to authenticated using (true);

drop policy if exists "Approved members can join a program" on public.mentoring_participants;
create policy "Approved members can join a program"
  on public.mentoring_participants for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists "Members can update own participation" on public.mentoring_participants;
create policy "Members can update own participation"
  on public.mentoring_participants for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Members can leave a program" on public.mentoring_participants;
create policy "Members can leave a program"
  on public.mentoring_participants for delete to authenticated
  using (user_id = auth.uid() or public.is_mentoring_program_owner(program_id, auth.uid()) or public.is_admin());

-- ---------- Matches (mentee requests → mentor accepts/declines) ----------
drop policy if exists "Involved parties can read matches" on public.mentoring_matches;
create policy "Involved parties can read matches"
  on public.mentoring_matches for select to authenticated
  using (
    mentor_id = auth.uid() or mentee_id = auth.uid()
    or public.is_mentoring_program_owner(program_id, auth.uid())
    or public.is_admin()
  );

-- A mentee can request a specific mentor within a program they're both
-- signed up for (self-service — doesn't require a human to pair everyone
-- up by hand).
drop policy if exists "Mentees can request a mentor" on public.mentoring_matches;
create policy "Mentees can request a mentor"
  on public.mentoring_matches for insert to authenticated
  with check (
    mentee_id = auth.uid()
    and requested_by = auth.uid()
    and status = 'pending'
    and public.is_approved()
    and exists (select 1 from public.mentoring_participants mp where mp.program_id = mentoring_matches.program_id and mp.user_id = mentoring_matches.mentor_id and mp.role = 'mentor')
    and exists (select 1 from public.mentoring_participants mp where mp.program_id = mentoring_matches.program_id and mp.user_id = mentoring_matches.mentee_id and mp.role = 'mentee')
  );

-- A program owner (or site admin) can create a match directly — manual
-- pairing, same convenience the reference's "Matches" count implies.
drop policy if exists "Program owners can create matches" on public.mentoring_matches;
create policy "Program owners can create matches"
  on public.mentoring_matches for insert to authenticated
  with check (public.is_mentoring_program_owner(program_id, auth.uid()) or public.is_admin());

-- The mentor accepts/declines a pending request; either party can cancel/
-- complete an active relationship; the program owner can manage any match.
drop policy if exists "Involved parties can update matches" on public.mentoring_matches;
create policy "Involved parties can update matches"
  on public.mentoring_matches for update to authenticated
  using (
    mentor_id = auth.uid() or mentee_id = auth.uid()
    or public.is_mentoring_program_owner(program_id, auth.uid())
    or public.is_admin()
  )
  with check (
    mentor_id = auth.uid() or mentee_id = auth.uid()
    or public.is_mentoring_program_owner(program_id, auth.uid())
    or public.is_admin()
  );

drop policy if exists "Involved parties can delete matches" on public.mentoring_matches;
create policy "Involved parties can delete matches"
  on public.mentoring_matches for delete to authenticated
  using (
    mentor_id = auth.uid() or mentee_id = auth.uid()
    or public.is_mentoring_program_owner(program_id, auth.uid())
    or public.is_admin()
  );

create index if not exists mentoring_participants_user_idx on public.mentoring_participants (user_id);
create index if not exists mentoring_matches_mentor_idx on public.mentoring_matches (mentor_id);
create index if not exists mentoring_matches_mentee_idx on public.mentoring_matches (mentee_id);

-- The Programs list shows a match count per program (like the reference's
-- "N Matches") even to members who aren't involved in any of them —
-- mentor/mentee counts are fine to compute client-side from the openly-
-- readable participants table, but individual matches are only visible to
-- the two people in them (see "Involved parties can read matches" above),
-- so a plain count(*) as a regular member would come back 0/undercounted.
-- This security-definer function hands back just the number, not the
-- underlying rows, so browsing the program list doesn't leak who's
-- matched with whom.
create or replace function public.mentoring_match_count(pid bigint)
returns bigint
language sql security definer set search_path = public
as $$
  select count(*) from public.mentoring_matches where program_id = pid and status in ('active', 'completed');
$$;
grant execute on function public.mentoring_match_count(bigint) to authenticated;


-- ============================================================
-- Migration 19  (schema-update-19.sql)
-- ============================================================
-- ============================================================
-- Update 19: Business Directory — a real `businesses` table (not just the
-- existing "business_categories" field on a profile), so an Eendragter can
-- list an actual company/practice with its own logo, category, contact
-- details and map pin, and admins can feature/promote listings.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.businesses (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  category text not null default 'Other',
  description text not null default '',
  website text not null default '',
  contact_email text not null default '',
  phone text not null default '',
  logo_url text default '',
  city text default '',
  country text default '',
  lat double precision,
  lng double precision,
  promoted boolean not null default false,   -- admin-only "featured" flag
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table public.businesses enable row level security;

-- Anyone signed in can browse the directory — same "read is open, write is
-- gated by approval + ownership" shape as jobs/events.
drop policy if exists "Members can read businesses" on public.businesses;
create policy "Members can read businesses"
  on public.businesses for select to authenticated using (true);

drop policy if exists "Approved members can list a business" on public.businesses;
create policy "Approved members can list a business"
  on public.businesses for insert to authenticated
  with check (owner_id = auth.uid() and public.is_approved());

-- Owners manage their own listing's details; only an admin can flip
-- `promoted` in practice (the client never exposes that toggle to a regular
-- owner), but RLS itself doesn't need to special-case the column — the UI
-- is the gate for that, same trust level as "Admins can update any post".
drop policy if exists "Owners and admins can update a business" on public.businesses;
create policy "Owners and admins can update a business"
  on public.businesses for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists "Owners and admins can delete a business" on public.businesses;
create policy "Owners and admins can delete a business"
  on public.businesses for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

create index if not exists businesses_owner_idx on public.businesses (owner_id);
create index if not exists businesses_promoted_idx on public.businesses (promoted, created_at desc);
create index if not exists businesses_category_idx on public.businesses (category);

-- ---------- BUSINESS LOGOS STORAGE ----------
-- Same per-user-folder pattern as job-logos/avatars: the first path segment
-- must be the uploader's own uid, so RLS can check it without a join.
insert into storage.buckets (id, name, public)
values ('business-logos', 'business-logos', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload business logos" on storage.objects;
create policy "Approved members can upload business logos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view business logos" on storage.objects;
create policy "Anyone can view business logos"
  on storage.objects for select
  using (bucket_id = 'business-logos');

drop policy if exists "Users can replace own business logos" on storage.objects;
create policy "Users can replace own business logos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own business logos" on storage.objects;
create policy "Users can delete own business logos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- REALTIME ----------
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'businesses';
  if not found then alter publication supabase_realtime add table public.businesses; end if;
end $$;


-- ============================================================
-- Migration 20  (schema-update-20.sql)
-- ============================================================
-- ============================================================
-- Update 20: Badges — definitions for the "Badges achieved" widget on the
-- Home dashboard. Earned/locked status is computed client-side from
-- existing data (profile completeness, posts, group_members, event_rsvps,
-- photos, mentoring_participants) — this table only holds the badge
-- definitions themselves (name/description/key), so Kyle can edit copy or
-- add new badges from the Supabase Table Editor without a code deploy.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.badges (
  id bigint generated always as identity primary key,
  key text not null unique,          -- matched against in the client's earned-badge logic
  name text not null,
  description text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.badges enable row level security;

drop policy if exists "Members can view badges" on public.badges;
create policy "Members can view badges"
  on public.badges for select to authenticated using (true);

insert into public.badges (key, name, description, sort_order) values
  ('profile_complete', 'Profile Pro', 'Filled out every section of your profile.', 1),
  ('first_post', 'First Post', 'Shared your first update with the house.', 2),
  ('joined_group', 'Group Member', 'Joined your first Eendrag group.', 3),
  ('event_goer', 'Event Goer', 'RSVP''d to an alumni event.', 4),
  ('photo_sharer', 'Photo Sharer', 'Added a photo to an album.', 5),
  ('mentor_connect', 'Mentor Connect', 'Joined the mentoring programme as a mentor or mentee.', 6)
on conflict (key) do nothing;


-- ============================================================
-- Migration 21  (schema-update-21.sql)
-- ============================================================
-- ============================================================
-- Update 21: Settings page — phone number + granular privacy controls,
-- real notification preferences (in-app "Platform" channel only — no
-- email-sending service or native mobile app exist yet, so Email/Mobile
-- toggles in the UI are cosmetic and don't need backend support here),
-- and self-service account deletion.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- PROFILE FIELDS ----------
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists language text not null default 'en';

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'privacy_phone') then
    alter table public.profiles add column privacy_phone text not null default 'all';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'privacy_email') then
    alter table public.profiles add column privacy_email text not null default 'all';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'privacy_location') then
    alter table public.profiles add column privacy_location text not null default 'all';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'privacy_messages') then
    alter table public.profiles add column privacy_messages text not null default 'all';
  end if;
end $$;

alter table public.profiles drop constraint if exists profiles_privacy_phone_check;
alter table public.profiles add constraint profiles_privacy_phone_check check (privacy_phone in ('all', 'mentoring', 'hide'));
alter table public.profiles drop constraint if exists profiles_privacy_email_check;
alter table public.profiles add constraint profiles_privacy_email_check check (privacy_email in ('all', 'mentoring', 'hide'));
alter table public.profiles drop constraint if exists profiles_privacy_location_check;
alter table public.profiles add constraint profiles_privacy_location_check check (privacy_location in ('all', 'mentoring', 'hide'));
alter table public.profiles drop constraint if exists profiles_privacy_messages_check;
alter table public.profiles add constraint profiles_privacy_messages_check check (privacy_messages in ('all', 'mentoring', 'hide'));

-- Note on scope: privacy_location only gates the contact details shown in
-- the full profile modal (via get_profile_contact below) — it does not
-- hide a member from the existing Directory list/map views, which already
-- show city/country broadly as a directory-browsing feature, not a
-- contact detail. Ask Kyle before extending "hide" to those too.

-- ---------- MENTORING RELATIONSHIP HELPER ----------
-- "Mentoring Relationships" privacy tier = you and the viewer have an
-- active mentor/mentee match (either direction).
create or replace function public.has_mentoring_relationship(a uuid, b uuid)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.mentoring_matches
    where status = 'active'
      and ((mentor_id = a and mentee_id = b) or (mentor_id = b and mentee_id = a))
  );
$$;

-- ---------- PRIVACY-AWARE CONTACT LOOKUP ----------
-- Returns phone/email/location for a profile, each nulled out per that
-- field's privacy setting relative to the viewer (auth.uid()). Always
-- returns real values when viewing your own profile. Runs as security
-- definer so it can read the real email off auth.users (profiles doesn't
-- store a duplicate copy) — ProfileModal calls this instead of selecting
-- these fields directly off `profiles`.
create or replace function public.get_profile_contact(target_id uuid)
returns table (phone text, email text, city text, country text)
language plpgsql security definer set search_path = public
as $$
declare
  v_phone text; v_privacy_phone text;
  v_email text; v_privacy_email text;
  v_city text; v_country text; v_privacy_location text;
  v_is_self boolean;
  v_related boolean;
begin
  v_is_self := (target_id = auth.uid());

  select p.phone, p.privacy_phone, p.city, p.country, p.privacy_location
    into v_phone, v_privacy_phone, v_city, v_country, v_privacy_location
    from public.profiles p where p.id = target_id;

  select u.email, pr.privacy_email into v_email, v_privacy_email
    from auth.users u
    join public.profiles pr on pr.id = u.id
    where u.id = target_id;

  if v_is_self then
    return query select v_phone, v_email, v_city, v_country;
    return;
  end if;

  v_related := public.has_mentoring_relationship(auth.uid(), target_id);

  if v_privacy_phone = 'hide' or (v_privacy_phone = 'mentoring' and not v_related) then v_phone := null; end if;
  if v_privacy_email = 'hide' or (v_privacy_email = 'mentoring' and not v_related) then v_email := null; end if;
  if v_privacy_location = 'hide' or (v_privacy_location = 'mentoring' and not v_related) then v_city := null; v_country := null; end if;

  return query select v_phone, v_email, v_city, v_country;
end;
$$;

revoke all on function public.get_profile_contact(uuid) from public;
grant execute on function public.get_profile_contact(uuid) to authenticated;

-- ---------- MESSAGE PRIVACY ----------
-- Re-defines get_or_create_conversation (originally in schema.sql, the base
-- 1:1 DM feature) to respect the target's privacy_messages setting. Only
-- gates *new*
-- conversations — an existing thread still works even if the other
-- person later tightens this setting, same as most apps' behaviour.
create or replace function public.get_or_create_conversation(other_user uuid)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  conv bigint;
  v_privacy_messages text;
begin
  if not public.is_approved() then
    raise exception 'Account not yet approved';
  end if;
  if other_user = auth.uid() then
    raise exception 'Cannot message yourself';
  end if;

  select cp1.conversation_id into conv
  from public.conversation_participants cp1
  join public.conversation_participants cp2
    on cp1.conversation_id = cp2.conversation_id
  where cp1.user_id = auth.uid() and cp2.user_id = other_user
  limit 1;

  if conv is null then
    select privacy_messages into v_privacy_messages from public.profiles where id = other_user;
    if v_privacy_messages = 'hide'
       or (v_privacy_messages = 'mentoring' and not public.has_mentoring_relationship(auth.uid(), other_user)) then
      raise exception 'This member is not accepting new messages right now';
    end if;

    insert into public.conversations default values returning id into conv;
    insert into public.conversation_participants (conversation_id, user_id)
    values (conv, auth.uid()), (conv, other_user);
  end if;

  return conv;
end;
$$;

-- ---------- SELF-SERVICE ACCOUNT DELETION ----------
-- Deletes the caller's own auth user; `profiles.id` references
-- `auth.users(id) on delete cascade`, and every table that references
-- `profiles(id)` already does the same (or `on delete set null`), so this
-- one delete cascades through posts/photos/messages/memberships/etc.
create or replace function public.delete_own_account()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

-- ---------- NOTIFICATION PREFERENCES ----------
-- Platform (in-app) notifications only — there's no email-sending service
-- or native mobile app behind this yet, so this table only needs to gate
-- what already exists: the `notifications` table used by NotificationBell.
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  notify_message boolean not null default true,
  notify_post_activity boolean not null default true,   -- likes + comments on your posts, combined
  notify_event_rsvp boolean not null default true,
  notify_event_comment boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;

drop policy if exists "Users can read own notification prefs" on public.notification_preferences;
create policy "Users can read own notification prefs"
  on public.notification_preferences for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can upsert own notification prefs" on public.notification_preferences;
create policy "Users can upsert own notification prefs"
  on public.notification_preferences for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update own notification prefs" on public.notification_preferences;
create policy "Users can update own notification prefs"
  on public.notification_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Re-define the 5 existing notify_* triggers (originally in schema-update-9)
-- to skip the insert when the recipient has turned that category off. A
-- missing preferences row (never visited Settings) defaults to "on" for
-- everything, matching notification_preferences' own column defaults.
create or replace function public.notify_post_like()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_author uuid;
  v_actor_name text;
  v_enabled boolean;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is null or v_author = new.user_id then return new; end if;
  select coalesce((select notify_post_activity from public.notification_preferences where user_id = v_author), true) into v_enabled;
  if not v_enabled then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_author, new.user_id, 'like', 'post', new.post_id,
          coalesce(v_actor_name, 'Someone') || ' liked your post');
  return new;
end;
$$;

create or replace function public.notify_post_comment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_author uuid;
  v_actor_name text;
  v_enabled boolean;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is null or v_author = new.author_id then return new; end if;
  select coalesce((select notify_post_activity from public.notification_preferences where user_id = v_author), true) into v_enabled;
  if not v_enabled then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.author_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_author, new.author_id, 'comment', 'post', new.post_id,
          coalesce(v_actor_name, 'Someone') || ' commented on your post');
  return new;
end;
$$;

create or replace function public.notify_event_rsvp()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid;
  v_title text;
  v_actor_name text;
  v_enabled boolean;
begin
  select created_by, title into v_creator, v_title from public.events where id = new.event_id;
  if v_creator is null or v_creator = new.user_id then return new; end if;
  select coalesce((select notify_event_rsvp from public.notification_preferences where user_id = v_creator), true) into v_enabled;
  if not v_enabled then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_creator, new.user_id, 'event_rsvp', 'event', new.event_id,
          coalesce(v_actor_name, 'Someone') || ' is going to ' || coalesce(v_title, 'your event'));
  return new;
end;
$$;

create or replace function public.notify_event_comment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid;
  v_title text;
  v_actor_name text;
  v_enabled boolean;
begin
  select created_by, title into v_creator, v_title from public.events where id = new.event_id;
  if v_creator is null or v_creator = new.author_id then return new; end if;
  select coalesce((select notify_event_comment from public.notification_preferences where user_id = v_creator), true) into v_enabled;
  if not v_enabled then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.author_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_creator, new.author_id, 'event_comment', 'event', new.event_id,
          coalesce(v_actor_name, 'Someone') || ' commented on ' || coalesce(v_title, 'your event'));
  return new;
end;
$$;

create or replace function public.notify_new_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_recipient uuid;
  v_actor_name text;
  v_enabled boolean;
begin
  select user_id into v_recipient
  from public.conversation_participants
  where conversation_id = new.conversation_id and user_id != new.sender_id
  limit 1;
  if v_recipient is null then return new; end if;
  select coalesce((select notify_message from public.notification_preferences where user_id = v_recipient), true) into v_enabled;
  if not v_enabled then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.sender_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_recipient, new.sender_id, 'message', 'conversation', new.conversation_id,
          coalesce(v_actor_name, 'Someone') || ' sent you a message');
  return new;
end;
$$;


-- ============================================================
-- Migration 22  (schema-update-22.sql)
-- ============================================================
-- ============================================================
-- Update 22: Business Directory listing upgrade — a short tagline/headline
-- shown above the "Read more" excerpt, and a separate big cover image
-- (distinct from the small logo) that displays before the business name on
-- both the card preview and the new standalone listing page.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.businesses add column if not exists tagline text not null default '';
alter table public.businesses add column if not exists cover_image_url text default '';

-- ---------- BUSINESS COVER IMAGES STORAGE ----------
-- Same per-user-folder pattern as business-logos: the first path segment
-- must be the uploader's own uid, so RLS can check it without a join.
insert into storage.buckets (id, name, public)
values ('business-covers', 'business-covers', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload business covers" on storage.objects;
create policy "Approved members can upload business covers"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'business-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view business covers" on storage.objects;
create policy "Anyone can view business covers"
  on storage.objects for select
  using (bucket_id = 'business-covers');

drop policy if exists "Users can replace own business covers" on storage.objects;
create policy "Users can replace own business covers"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'business-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own business covers" on storage.objects;
create policy "Users can delete own business covers"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'business-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================
-- Migration 23  (schema-update-23.sql)
-- ============================================================
-- ============================================================
-- Update 23: Event map pins — Events board sidebar now shows a map of
-- upcoming events, which needs coordinates the same way businesses/profiles
-- already do. Geocoded from the event's free-text `location` field on
-- save (may not resolve precisely for very specific addresses, but most
-- should land close enough to be useful).
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.events add column if not exists lat double precision;
alter table public.events add column if not exists lng double precision;


-- ============================================================
-- Migration 24  (schema-update-24.sql)
-- ============================================================
-- ============================================================
-- Update 24: Enhanced event editing — start/end times, URL, image, registration limit
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- Add new event fields for enhanced editing
alter table public.events add column if not exists event_start_time timestamptz;
alter table public.events add column if not exists event_end_time timestamptz;
alter table public.events add column if not exists event_url text default '';
alter table public.events add column if not exists image_url text default '';
alter table public.events add column if not exists max_registrations integer;  -- null = unlimited

-- Note: existing event_date column becomes the start date if migrating old events.
-- Consider a backfill script if needed to populate event_start_time from event_date.

-- Storage bucket for event images
insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do nothing;

-- Policies for event image uploads
drop policy if exists "Approved members can upload event images" on storage.objects;
create policy "Approved members can upload event images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view event images" on storage.objects;
create policy "Anyone can view event images"
  on storage.objects for select
  using (bucket_id = 'event-images');

drop policy if exists "Users can delete own event images" on storage.objects;
create policy "Users can delete own event images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================
-- Migration 25  (schema-update-25.sql)
-- ============================================================
-- ============================================================
-- Update 25: Work experience entries on profiles (repeatable
-- title/company/industry/date blocks, edited from the profile page)
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.profiles add column if not exists experience jsonb default '[]'::jsonb;

-- Each element: { "title": text, "company": text, "industry": text,
--                 "from": "YYYY-MM" or "", "to": "YYYY-MM" or "" (blank = present) }


-- ============================================================
-- Migration 26  (schema-update-26.sql)
-- ============================================================
-- ============================================================
-- Update 26: Job listing detail page — industry, a general company
-- website link (separate from the apply URL), an optional PDF
-- attachment, an explicit apply-method + secondary email, a closing
-- date for applications, and a map pin (same lat/lng pattern as
-- businesses) so the standalone job page can show a location map.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.jobs add column if not exists industry text default '';
alter table public.jobs add column if not exists company_website text default '';
alter table public.jobs add column if not exists attachment_url text default '';
alter table public.jobs add column if not exists attachment_name text default '';
alter table public.jobs add column if not exists additional_email text default '';
alter table public.jobs add column if not exists closing_date date;
alter table public.jobs add column if not exists lat double precision;
alter table public.jobs add column if not exists lng double precision;

-- ---------- JOB ATTACHMENTS STORAGE (PDF job descriptions) ----------
-- Same per-user-folder pattern as job-logos: the first path segment must be
-- the uploader's own uid, so RLS can check it without a join.
insert into storage.buckets (id, name, public)
values ('job-attachments', 'job-attachments', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload job attachments" on storage.objects;
create policy "Approved members can upload job attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'job-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view job attachments" on storage.objects;
create policy "Anyone can view job attachments"
  on storage.objects for select
  using (bucket_id = 'job-attachments');

drop policy if exists "Users can replace own job attachments" on storage.objects;
create policy "Users can replace own job attachments"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'job-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own job attachments" on storage.objects;
create policy "Users can delete own job attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'job-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================
-- Migration 27  (schema-update-27.sql)
-- ============================================================
-- Update 27: Merchandise (Eendrag store)
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- This is an official, admin-curated store (hoodies, mugs, caps, etc.) —
-- unlike jobs/businesses, ordinary members can browse and order but only
-- admins can create/edit/remove listings. "Order" is a contact-to-order
-- flow (an in-app message to whichever admin listed the item), same as
-- Business Directory's "Message about this business" — there is no
-- payment processing anywhere in this app yet (see Donate.jsx), so this
-- deliberately doesn't add one either.

create table if not exists public.merchandise (
  id bigint generated always as identity primary key,
  name text not null,
  description text not null default '',
  price numeric(10,2) not null default 0,
  category text not null default 'Other',
  sizes text[] not null default '{}',
  colors text[] not null default '{}',
  image_url text default '',
  is_available boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.merchandise enable row level security;

drop policy if exists "Anyone signed in can view merchandise" on public.merchandise;
create policy "Anyone signed in can view merchandise"
  on public.merchandise for select
  to authenticated
  using (true);

-- Admin-only writes — the one precedent for this shape elsewhere in the
-- app is jobs/businesses' owner-or-admin OR-policy; here there's no owner
-- half at all, so it's simply public.is_admin() on every write.
drop policy if exists "Admins can create merchandise" on public.merchandise;
create policy "Admins can create merchandise"
  on public.merchandise for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update merchandise" on public.merchandise;
create policy "Admins can update merchandise"
  on public.merchandise for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete merchandise" on public.merchandise;
create policy "Admins can delete merchandise"
  on public.merchandise for delete
  to authenticated
  using (public.is_admin());

-- Storage: item photos, same public-read/scoped-write shape as
-- business-logos/job-logos, except write access is admin-only instead of
-- folder-owner, since only admins ever upload merch photos.
insert into storage.buckets (id, name, public)
values ('merch-images', 'merch-images', true)
on conflict (id) do nothing;

drop policy if exists "Public can view merch images" on storage.objects;
create policy "Public can view merch images"
  on storage.objects for select
  using (bucket_id = 'merch-images');

drop policy if exists "Admins can upload merch images" on storage.objects;
create policy "Admins can upload merch images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'merch-images' and public.is_admin());

drop policy if exists "Admins can update merch images" on storage.objects;
create policy "Admins can update merch images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'merch-images' and public.is_admin());

drop policy if exists "Admins can delete merch images" on storage.objects;
create policy "Admins can delete merch images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'merch-images' and public.is_admin());


-- ============================================================
-- Migration 28  (schema-update-28.sql)
-- ============================================================
-- ============================================================
-- Update 28: Content reporting/flagging (member-facing) and mentoring
-- match notifications (request + accept/decline), tying Mentoring into
-- the same notification bell every other feature already uses.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ============================================================
-- REPORTS — lets any signed-in member flag a post, job, business
-- listing or profile for admin review, instead of moderation being
-- entirely admin-initiated (delete-only, nothing to act on unless an
-- admin happens to spot it themselves).
-- ============================================================
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  -- entity_id stored as text (not bigint/uuid) since it points at rows
  -- across several tables with different id types (posts/jobs/businesses
  -- are bigint, profiles is uuid) — resolved back to the right type
  -- client-side using entity_type, same idea as notifications.entity_id
  -- being interpreted per entity_type there.
  entity_type text not null check (entity_type in ('post', 'job', 'business', 'profile', 'group_post')),
  entity_id text not null,
  reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'scam', 'other')),
  details text not null default '',
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;

-- Filing a report doesn't require approval — it's a safety action, not a
-- content-creation privilege, so it stays available even to a pending
-- signup who spots something they shouldn't have.
drop policy if exists "Members can file reports" on public.reports;
create policy "Members can file reports"
  on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());

-- Reporters can see their own reports (so they know it went through);
-- admins can see everything for review.
drop policy if exists "Reporters and admins can read reports" on public.reports;
create policy "Reporters and admins can read reports"
  on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());

-- Only admins resolve reports (mark reviewed/dismissed).
drop policy if exists "Admins can update reports" on public.reports;
create policy "Admins can update reports"
  on public.reports for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create index if not exists reports_status_idx on public.reports (status, created_at desc);

-- ============================================================
-- MENTORING NOTIFICATIONS — mentoring_matches already exists
-- (schema-update-18.sql) with a full request/accept/decline flow, but
-- unlike posts/events/messages it never told anyone anything happened.
-- These two triggers plug it into the same notifications table +
-- notify_* preference pattern from schema-update-9/21.
-- ============================================================
alter table public.notification_preferences add column if not exists notify_mentoring boolean not null default true;

-- ---------- Trigger: a mentee requests you as a mentor ----------
create or replace function public.notify_mentoring_match_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor_name text;
  v_title text;
  v_enabled boolean;
begin
  -- Only the mentee-initiated "request a mentor" self-service path (see
  -- the "Mentees can request a mentor" RLS policy) counts as something
  -- worth notifying about — a program owner manually pairing two people
  -- isn't a request either side needs to respond to.
  if new.status != 'pending' or new.requested_by is distinct from new.mentee_id then return new; end if;

  select coalesce((select notify_mentoring from public.notification_preferences where user_id = new.mentor_id), true) into v_enabled;
  if not v_enabled then return new; end if;

  select title into v_title from public.mentoring_programs where id = new.program_id;
  select full_name into v_actor_name from public.profiles where id = new.mentee_id;

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (
    new.mentor_id, new.mentee_id, 'mentoring_match', 'mentoring_match', new.id,
    coalesce(v_actor_name, 'Someone') || ' requested you as a mentor' ||
      (case when v_title is not null then ' for ' || v_title else '' end)
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_mentoring_match_request on public.mentoring_matches;
create trigger trg_notify_mentoring_match_request
  after insert on public.mentoring_matches
  for each row execute function public.notify_mentoring_match_request();

-- ---------- Trigger: a mentor accepts/declines your request ----------
create or replace function public.notify_mentoring_match_response()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_recipient uuid;
  v_actor_name text;
  v_title text;
  v_enabled boolean;
begin
  if old.status = new.status then return new; end if;
  if new.status not in ('active', 'declined') then return new; end if;

  -- No explicit "actor" column on mentoring_matches, so infer it from who's
  -- actually making this update — the other party (not auth.uid()) is who
  -- gets notified. Falls back to doing nothing if that can't be determined
  -- (e.g. an admin/program-owner update on someone else's behalf) rather
  -- than guessing wrong and notifying the person who just acted.
  v_recipient := case when auth.uid() = new.mentor_id then new.mentee_id when auth.uid() = new.mentee_id then new.mentor_id else null end;
  if v_recipient is null then return new; end if;

  select coalesce((select notify_mentoring from public.notification_preferences where user_id = v_recipient), true) into v_enabled;
  if not v_enabled then return new; end if;

  select title into v_title from public.mentoring_programs where id = new.program_id;
  select full_name into v_actor_name from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (
    v_recipient, auth.uid(), 'mentoring_match', 'mentoring_match', new.id,
    case
      when new.status = 'active' then
        coalesce(v_actor_name, 'Someone') || ' accepted your mentoring request' ||
          (case when v_title is not null then ' for ' || v_title else '' end)
      else
        coalesce(v_actor_name, 'Someone') || ' declined your mentoring request'
    end
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_mentoring_match_response on public.mentoring_matches;
create trigger trg_notify_mentoring_match_response
  after update on public.mentoring_matches
  for each row execute function public.notify_mentoring_match_response();


-- ============================================================
-- Migration 29  (schema-update-29.sql)
-- ============================================================
-- ============================================================
-- Update 29: Scalable "last message per conversation" lookup
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Problem this fixes:
--   Messages.jsx's thread list used to fetch every message across every
--   conversation the user is in (no .limit()), just to pick the single
--   most recent one per conversation client-side. A user with 20
--   conversations of 500 messages each pulled 10,000 rows to render 20
--   preview lines.
--
-- Fix:
--   A DISTINCT ON query, run server-side, that returns exactly one row
--   (the latest) per conversation. Only ever returns conversations the
--   caller actually participates in — enforced with is_participant(),
--   the same helper the RLS policies on messages/conversations use.
-- ============================================================

create or replace function public.last_messages_for_conversations(conv_ids bigint[])
returns table (conversation_id bigint, content text, created_at timestamptz, sender_id uuid)
language sql security definer set search_path = public
as $$
  select distinct on (m.conversation_id)
    m.conversation_id, m.content, m.created_at, m.sender_id
  from public.messages m
  where m.conversation_id = any(conv_ids)
    and public.is_participant(m.conversation_id, auth.uid())
  order by m.conversation_id, m.created_at desc;
$$;

revoke all on function public.last_messages_for_conversations(bigint[]) from public;
grant execute on function public.last_messages_for_conversations(bigint[]) to authenticated;


-- ============================================================
-- Migration 30  (schema-update-30.sql)
-- ============================================================
-- ============================================================
-- Update 30: Missing indexes on hot foreign-key columns
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Problem this fixes:
--   Postgres does not automatically index foreign-key columns. Several of
--   the busiest queries in the app (loading the Feed, opening a
--   conversation, listing which conversations a person is in) filter on
--   columns that have never had an index, so they've been doing a
--   sequential scan of the whole table. Fine at today's row counts;
--   increasingly not as posts/messages accumulate.
--
-- Notes:
--   conversation_participants(conversation_id) doesn't need its own index
--   here — it's already the leading column of the table's composite
--   primary key (conversation_id, user_id), so lookups by conversation_id
--   alone are already indexed. user_id is the *second* column of that key,
--   so "which conversations is this person in" (used to build the
--   Messages.jsx thread list) gets nothing from the existing PK and needs
--   its own index.
-- ============================================================

create index if not exists posts_author_id_idx on public.posts (author_id);
create index if not exists messages_conversation_id_idx on public.messages (conversation_id);
create index if not exists messages_sender_id_idx on public.messages (sender_id);
create index if not exists conversation_participants_user_id_idx on public.conversation_participants (user_id);


-- ============================================================
-- Migration 31  (schema-update-31.sql)
-- ============================================================
-- ============================================================
-- Update 31: Merchandise wishlist
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Problem this fixes:
--   MerchDetail.jsx's heart/wishlist button only ever toggled local
--   component state — it implied it was saving something, but a refresh
--   silently reset it and it never persisted anywhere. This is the same
--   shape as post_likes (schema-update-2.sql): a plain per-user,
--   per-item join table.
-- ============================================================

create table if not exists public.merch_wishlist (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id bigint not null references public.merchandise(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.merch_wishlist enable row level security;

drop policy if exists "Users can read own wishlist" on public.merch_wishlist;
create policy "Users can read own wishlist"
  on public.merch_wishlist for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can add to own wishlist" on public.merch_wishlist;
create policy "Users can add to own wishlist"
  on public.merch_wishlist for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can remove from own wishlist" on public.merch_wishlist;
create policy "Users can remove from own wishlist"
  on public.merch_wishlist for delete to authenticated
  using (user_id = auth.uid());


-- ============================================================
-- Migration 32  (schema-update-32.sql)
-- ============================================================
-- ============================================================
-- Update 32: Batched mentoring match counts
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Problem this fixes:
--   Mentoring.jsx's load() called the mentoring_match_count(pid) RPC once
--   per program (via Promise.all) just to show each program's match count
--   in the Programs tab — an N+1 query pattern where a site with 20
--   mentoring programs fired 20 separate round trips to render 20 numbers.
--   This adds a batched equivalent that takes every program id at once and
--   returns one row per program, so the frontend can do it in a single
--   call instead. mentoring_match_count(bigint) (schema-update-18.sql) is
--   left in place — nothing else references it, but there's no need to
--   drop it.
-- ============================================================

create or replace function public.mentoring_match_counts(pids bigint[])
returns table (program_id bigint, cnt bigint)
language sql security definer set search_path = public
as $$
  select p as program_id, count(m.id) as cnt
  from unnest(pids) as p
  left join public.mentoring_matches m
    on m.program_id = p and m.status in ('active', 'completed')
  group by p;
$$;

grant execute on function public.mentoring_match_counts(bigint[]) to authenticated;


-- ============================================================
-- Migration 33  (schema-update-33.sql)
-- ============================================================
-- ============================================================
-- Update 33: message editing, deletion, reactions, typing
-- indicators and read receipts for Messages.jsx.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- Edit / soft-delete ----------
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;

-- Row-level security can restrict *which rows* an UPDATE can touch, but
-- not which columns change within an allowed row — a sender editing their
-- own message could, without more, also rewrite conversation_id or
-- sender_id on it via a raw .update() call. edit_message()/delete_message()
-- below are the only sanctioned way to change an existing message, so the
-- update policy just gates row ownership and the two RPCs gate the rest.
drop policy if exists "Senders can update own messages" on public.messages;
create policy "Senders can update own messages"
  on public.messages for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- Edits a message's content and stamps edited_at — the sender-only check
-- is enforced here (not just the policy above) so a bad client can't also
-- sneak in a change to created_at/conversation_id/sender_id.
create or replace function public.edit_message(msg_id bigint, new_content text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if new_content is null or char_length(trim(new_content)) = 0 or char_length(new_content) > 4000 then
    raise exception 'Message must be between 1 and 4000 characters';
  end if;
  update public.messages
  set content = trim(new_content), edited_at = now()
  where id = msg_id and sender_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'Message not found, not yours, or already deleted';
  end if;
end;
$$;

-- Soft-delete: keeps the row (so "This message was deleted" can render in
-- its place, same pattern WhatsApp/Slack use for thread continuity)
-- rather than removing it outright, which would leave a confusing gap in
-- the other participant's view mid-conversation.
create or replace function public.delete_message(msg_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.messages
  set content = '', deleted_at = now()
  where id = msg_id and sender_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'Message not found, not yours, or already deleted';
  end if;
  delete from public.message_reactions where message_id = msg_id;
end;
$$;

-- ---------- Reactions ----------
create table if not exists public.message_reactions (
  message_id bigint not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.message_reactions enable row level security;

drop policy if exists "Participants can read reactions" on public.message_reactions;
create policy "Participants can read reactions"
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_participant(m.conversation_id, auth.uid())
    )
  );

drop policy if exists "Participants can react" on public.message_reactions;
create policy "Participants can react"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_participant(m.conversation_id, auth.uid()) and m.deleted_at is null
    )
  );

drop policy if exists "Users can remove own reactions" on public.message_reactions;
create policy "Users can remove own reactions"
  on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

-- ---------- Realtime ----------
-- message_reactions needs realtime for live reaction updates. Typing
-- indicators use Supabase Realtime Broadcast instead of a table (nobody
-- needs a durable record that so-and-so was typing a minute ago), so
-- nothing to add there. conversation_participants (last_read_at, from
-- schema-update-6.sql) needs it too — without this, "Seen" only ever
-- updated for the reader themselves on next page load, never live for the
-- person who sent the message.
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'message_reactions';
  if not found then alter publication supabase_realtime add table public.message_reactions; end if;

  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversation_participants';
  if not found then alter publication supabase_realtime add table public.conversation_participants; end if;
end $$;


-- ============================================================
-- Migration 34  (schema-update-34.sql)
-- ============================================================
-- ============================================================
-- Update 34: remember the last-used photo crop (zoom, position,
-- rotation, flip, filter/adjustments) so reopening the editor on
-- an existing avatar restores exactly where you left off — like
-- LinkedIn's profile photo editor — instead of resetting to a
-- centered, unzoomed default every time.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.profiles add column if not exists avatar_crop jsonb;

-- No RLS change needed: avatar_crop rides along on the same
-- profiles row/update policy as avatar_url.


-- ============================================================
-- Migration 35  (schema-update-35.sql)
-- ============================================================
-- ============================================================
-- Update 35: Mentoring experience improvements — mentor bios,
-- goals, session notes, and completion reviews.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- MENTOR BIO ----------
-- A short intro mentors can write when joining a program, shown on the
-- "Find a Mentor" cards so mentees know what they specialise in / offer.
alter table public.mentoring_participants
  add column if not exists mentor_bio text not null default '';

-- ---------- COMPLETION NOTE ----------
-- When a relationship is marked "completed", both parties can leave a
-- short note (what they got out of it, a thank-you, etc.).
alter table public.mentoring_matches
  add column if not exists completion_note text not null default '';

-- ---------- MENTORING GOALS ----------
-- Lightweight shared goal/milestone tracker per match.
create table if not exists public.mentoring_goals (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.mentoring_matches(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.mentoring_goals enable row level security;

drop policy if exists "Match parties can read goals" on public.mentoring_goals;
create policy "Match parties can read goals"
  on public.mentoring_goals for select to authenticated
  using (
    exists (
      select 1 from public.mentoring_matches m
      where m.id = match_id
        and (m.mentor_id = auth.uid() or m.mentee_id = auth.uid())
    )
  );

drop policy if exists "Match parties can create goals" on public.mentoring_goals;
create policy "Match parties can create goals"
  on public.mentoring_goals for insert to authenticated
  with check (
    exists (
      select 1 from public.mentoring_matches m
      where m.id = match_id
        and m.status = 'active'
        and (m.mentor_id = auth.uid() or m.mentee_id = auth.uid())
    )
  );

drop policy if exists "Match parties can update goals" on public.mentoring_goals;
create policy "Match parties can update goals"
  on public.mentoring_goals for update to authenticated
  using (
    exists (
      select 1 from public.mentoring_matches m
      where m.id = match_id
        and (m.mentor_id = auth.uid() or m.mentee_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.mentoring_matches m
      where m.id = match_id
        and (m.mentor_id = auth.uid() or m.mentee_id = auth.uid())
    )
  );

drop policy if exists "Match parties can delete goals" on public.mentoring_goals;
create policy "Match parties can delete goals"
  on public.mentoring_goals for delete to authenticated
  using (
    exists (
      select 1 from public.mentoring_matches m
      where m.id = match_id
        and (m.mentor_id = auth.uid() or m.mentee_id = auth.uid())
    )
  );

create index if not exists mentoring_goals_match_idx on public.mentoring_goals (match_id);

-- ---------- MENTORING NOTES ----------
-- Session log / meeting notes shared between mentor and mentee.
create table if not exists public.mentoring_notes (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.mentoring_matches(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  session_date date,
  created_at timestamptz not null default now()
);
alter table public.mentoring_notes enable row level security;

drop policy if exists "Match parties can read notes" on public.mentoring_notes;
create policy "Match parties can read notes"
  on public.mentoring_notes for select to authenticated
  using (
    exists (
      select 1 from public.mentoring_matches m
      where m.id = match_id
        and (m.mentor_id = auth.uid() or m.mentee_id = auth.uid())
    )
  );

drop policy if exists "Match parties can create notes" on public.mentoring_notes;
create policy "Match parties can create notes"
  on public.mentoring_notes for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.mentoring_matches m
      where m.id = match_id
        and (m.mentor_id = auth.uid() or m.mentee_id = auth.uid())
    )
  );

drop policy if exists "Authors can update own notes" on public.mentoring_notes;
create policy "Authors can update own notes"
  on public.mentoring_notes for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "Authors can delete own notes" on public.mentoring_notes;
create policy "Authors can delete own notes"
  on public.mentoring_notes for delete to authenticated
  using (author_id = auth.uid());

create index if not exists mentoring_notes_match_idx on public.mentoring_notes (match_id);


-- ============================================================
-- Migration 36  (schema-update-36.sql)
-- ============================================================
-- ============================================================
-- Update 36: Business profile -> Mentoring. The old "Business
-- categories" field (Founder/Entrepreneur, Investor/Advisor, etc.)
-- was never surfaced in the profile editor — only read-only on
-- PersonProfile/ProfileModal — and doesn't fit the section's new
-- mentoring framing, so it's being dropped rather than carried
-- forward. Everything else that section held (availability,
-- geographic focus, expertise, services offered, business website,
-- open-to-opportunities) is unaffected and keeps its existing column.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.profiles drop column if exists business_categories;


-- ============================================================
-- Migration 37  (schema-update-37.sql)
-- ============================================================
-- ============================================================
-- Update 37: Remove mentoring "programs" entirely. Mentorship is now
-- purely profile-driven: a member shows up under Find a Mentor as soon
-- as their profile has "Open to mentoring and other opportunities" = yes
-- and "Mentoring/Coaching" checked under services offered. No signing up
-- to a program, no mentee opt-in gate either — any approved member can
-- request any mentor directly. Requests still go pending -> active/
-- declined, but the relationship itself is simplified: no goals
-- checklist, no session notes, no completion note. Ending an active
-- relationship is just removing the match (either party, any time).
--
-- Verified against live data before writing this: mentoring_matches,
-- mentoring_goals, mentoring_notes and mentoring_participants were all
-- empty (0 rows) and there was exactly 1 mentoring_programs row with no
-- participants, so there is nothing real to migrate off of the old
-- shape — this is a straight drop, not a data-preserving migration.
--
-- Also fixes a latent bug found while doing this: services_offered was
-- defined as a plain `text` column (unlike its siblings expertise and
-- geographic_focus, which are real `text[]`), so it only ever held the
-- JSON-stringified form of the array (e.g. the literal characters
-- '["Mentoring/Coaching"]') rather than an actual array. Every .includes()
-- check against it elsewhere in the app happened to keep working because
-- it degraded to a substring search, but the new "does this mentor
-- profile qualify" RLS check below needs a real array to use `@>`
-- containment, so this converts the column properly. No real data existed
-- in it yet (every row was '' or '[]'), so the backfill is a formality.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- FIX services_offered COLUMN TYPE ----------
-- On the original Eendrag DB, services_offered was mistakenly created as
-- plain `text`. This block converts it to `text[]`. On a fresh install
-- (like sacs-hub) migration 12 already declares it as text[], so the
-- conversion is a no-op — the DO block below detects the current type
-- and skips the migration when nothing needs fixing.
do $$
declare
  v_type text;
begin
  select data_type into v_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name = 'services_offered';

  if v_type is null then
    -- Column doesn't exist yet — mig 12 will add it as text[]. Nothing to do.
    return;
  end if;

  if v_type = 'ARRAY' then
    -- Already text[]. Nothing to fix.
    return;
  end if;

  -- Legacy text column — do the original conversion.
  alter table public.profiles add column if not exists services_offered_new text[] not null default '{}';

  update public.profiles
  set services_offered_new = (
    case
      when services_offered is null or trim(services_offered) = '' then '{}'::text[]
      when services_offered ~ '^\s*\[.*\]\s*$' then (
        select coalesce(array_agg(x), '{}'::text[])
        from jsonb_array_elements_text(services_offered::jsonb) as x
      )
      else string_to_array(nullif(trim(services_offered), ''), ',')
    end
  )
  where services_offered_new = '{}';

  alter table public.profiles drop column if exists services_offered;
  alter table public.profiles rename column services_offered_new to services_offered;
end $$;

-- ---------- DROP mentoring_matches POLICIES FIRST ----------
-- (they reference is_mentoring_program_owner, which we're about to drop)
drop policy if exists "Involved parties can read matches" on public.mentoring_matches;
drop policy if exists "Mentees can request a mentor" on public.mentoring_matches;
drop policy if exists "Program owners can create matches" on public.mentoring_matches;
drop policy if exists "Involved parties can update matches" on public.mentoring_matches;
drop policy if exists "Involved parties can delete matches" on public.mentoring_matches;

-- ---------- NOW DROP PROGRAM-RELATED OBJECTS ----------
drop table if exists public.mentoring_goals cascade;
drop table if exists public.mentoring_notes cascade;
drop table if exists public.mentoring_participants cascade;
drop table if exists public.mentoring_programs cascade;

drop function if exists public.mentoring_match_count(bigint);
drop function if exists public.mentoring_match_counts(bigint[]);
drop function if exists public.is_mentoring_program_owner(bigint, uuid);

-- ---------- SIMPLIFY mentoring_matches SHAPE ----------
alter table public.mentoring_matches drop constraint if exists mentoring_matches_program_id_mentor_id_mentee_id_key;
alter table public.mentoring_matches drop column if exists program_id;
alter table public.mentoring_matches drop column if exists completion_note;

alter table public.mentoring_matches drop constraint if exists mentoring_matches_status_check;
alter table public.mentoring_matches add constraint mentoring_matches_status_check
  check (status in ('pending', 'active', 'declined'));

alter table public.mentoring_matches drop constraint if exists mentoring_matches_mentor_mentee_key;
alter table public.mentoring_matches add constraint mentoring_matches_mentor_mentee_key
  unique (mentor_id, mentee_id);

-- Read: either party in the match, or an admin.
create policy "Involved parties can read matches"
  on public.mentoring_matches for select to authenticated
  using (
    mentor_id = auth.uid() or mentee_id = auth.uid() or public.is_admin()
  );

-- Insert: a mentee can request anyone whose profile currently qualifies
-- as a mentor (open to opportunities + "Mentoring/Coaching" checked).
-- This is the whole eligibility gate now — no participants table to join.
create policy "Members can request a mentor"
  on public.mentoring_matches for insert to authenticated
  with check (
    mentee_id = auth.uid()
    and requested_by = auth.uid()
    and status = 'pending'
    and mentor_id <> auth.uid()
    and public.is_approved()
    and exists (
      select 1 from public.profiles p
      where p.id = mentoring_matches.mentor_id
        and p.is_open_to_opportunities = true
        and p.services_offered @> array['Mentoring/Coaching']::text[]
    )
  );

-- Admins can still create a match by hand (support requests etc.).
create policy "Admins can create matches directly"
  on public.mentoring_matches for insert to authenticated
  with check (public.is_admin());

-- Update: mentor accepts/declines a pending request; either party can
-- update their own active match (there's no more "completed" status —
-- ending a relationship is a delete, see below).
create policy "Involved parties can update matches"
  on public.mentoring_matches for update to authenticated
  using (mentor_id = auth.uid() or mentee_id = auth.uid() or public.is_admin())
  with check (mentor_id = auth.uid() or mentee_id = auth.uid() or public.is_admin());

-- Delete: either party can remove/unmatch at any time (declined, or
-- ending an active relationship), admins can moderate.
create policy "Involved parties can delete matches"
  on public.mentoring_matches for delete to authenticated
  using (mentor_id = auth.uid() or mentee_id = auth.uid() or public.is_admin());

-- ---------- NOTIFICATIONS: drop the program-title lookups ----------
create or replace function public.notify_mentoring_match_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor_name text;
  v_enabled boolean;
begin
  if new.status != 'pending' or new.requested_by is distinct from new.mentee_id then return new; end if;

  select coalesce((select notify_mentoring from public.notification_preferences where user_id = new.mentor_id), true) into v_enabled;
  if not v_enabled then return new; end if;

  select full_name into v_actor_name from public.profiles where id = new.mentee_id;

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (
    new.mentor_id, new.mentee_id, 'mentoring_match', 'mentoring_match', new.id,
    coalesce(v_actor_name, 'Someone') || ' requested you as a mentor'
  );
  return new;
end;
$$;

create or replace function public.notify_mentoring_match_response()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_recipient uuid;
  v_actor_name text;
  v_enabled boolean;
begin
  if old.status = new.status then return new; end if;
  if new.status not in ('active', 'declined') then return new; end if;

  v_recipient := case when auth.uid() = new.mentor_id then new.mentee_id when auth.uid() = new.mentee_id then new.mentor_id else null end;
  if v_recipient is null then return new; end if;

  select coalesce((select notify_mentoring from public.notification_preferences where user_id = v_recipient), true) into v_enabled;
  if not v_enabled then return new; end if;

  select full_name into v_actor_name from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (
    v_recipient, auth.uid(), 'mentoring_match', 'mentoring_match', new.id,
    case
      when new.status = 'active' then coalesce(v_actor_name, 'Someone') || ' accepted your mentoring request'
      else coalesce(v_actor_name, 'Someone') || ' declined your mentoring request'
    end
  );
  return new;
end;
$$;


-- ============================================================
-- Migration 38  (schema-update-38.sql)
-- ============================================================
-- ============================================================
-- Update 38: Drop the "Mentoring/Coaching" service tag as a mentor
-- eligibility requirement. Kyle wants a single toggle — "Open to
-- mentoring and other opportunities" (profiles.is_open_to_opportunities)
-- — to be the only thing that puts someone under Find a Mentor. The
-- services-offered tag was a second, redundant gate stacked on top of it
-- (see schema-update-37.sql, which introduced the profile-driven check);
-- this removes that second requirement and drops the tag itself from the
-- SERVICES_OFFERED list in the frontend (constants.js).
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

drop policy if exists "Members can request a mentor" on public.mentoring_matches;

create policy "Members can request a mentor"
  on public.mentoring_matches for insert to authenticated
  with check (
    mentee_id = auth.uid()
    and requested_by = auth.uid()
    and status = 'pending'
    and mentor_id <> auth.uid()
    and public.is_approved()
    and exists (
      select 1 from public.profiles p
      where p.id = mentoring_matches.mentor_id
        and p.is_open_to_opportunities = true
    )
  );

-- Nobody had "Mentoring/Coaching" set in services_offered yet (checked
-- before writing this), so there's no stale data to clean up. If that
-- changes before this runs, this strips it out defensively so it doesn't
-- linger as an orphaned value with no UI control left to unset it:
update public.profiles
set services_offered = array_remove(services_offered, 'Mentoring/Coaching')
where services_offered @> array['Mentoring/Coaching']::text[];


-- ============================================================
-- Migration 39  (schema-update-39.sql)
-- ============================================================
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


-- ============================================================
-- Migration 40  (schema-update-40.sql)
-- ============================================================
-- ============================================================
-- Update 40: Remove Groups feature entirely.
-- Drops tables, functions, triggers, storage buckets, RLS
-- policies, the joined_group badge, and the group_post report
-- type. Safe to re-run.
-- ============================================================

-- ---------- 1. Remove from realtime publication ----------
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_posts';
  if found then alter publication supabase_realtime drop table public.group_posts; end if;
end $$;
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_members';
  if found then alter publication supabase_realtime drop table public.group_members; end if;
end $$;

-- ---------- 2. Drop trigger + functions ----------
drop trigger if exists trg_new_group_admin on public.groups;
drop function if exists public.handle_new_group() cascade;
drop function if exists public.is_group_admin(bigint, uuid) cascade;
drop function if exists public.is_group_member(bigint, uuid) cascade;

-- ---------- 3. Drop tables (cascade removes RLS policies + FKs) ----------
drop table if exists public.group_post_comments cascade;
drop table if exists public.group_post_likes cascade;
drop table if exists public.group_posts cascade;
drop table if exists public.group_members cascade;
drop table if exists public.groups cascade;

-- ---------- 4. Storage: remove policies then buckets ----------
-- group-covers policies
drop policy if exists "Approved members can upload group covers" on storage.objects;
drop policy if exists "Anyone can view group covers" on storage.objects;
drop policy if exists "Uploaders can replace group covers" on storage.objects;
drop policy if exists "Uploaders can delete group covers" on storage.objects;

-- group-post-images policies
drop policy if exists "Approved members can upload group post images" on storage.objects;
drop policy if exists "Anyone can view group post images" on storage.objects;
drop policy if exists "Users can delete own group post images" on storage.objects;

-- Supabase blocks direct SQL deletes on storage.objects — empty
-- these two buckets from the Supabase dashboard (Storage tab) or
-- the Storage API, then uncomment the lines below to drop them:
-- delete from storage.buckets where id = 'group-covers';
-- delete from storage.buckets where id = 'group-post-images';

-- ---------- 5. Remove joined_group badge ----------
delete from public.badges where key = 'joined_group';

-- ---------- 6. Remove group_post from reports check constraint ----------
-- Replace the existing check constraint with one that excludes group_post.
do $$
begin
  -- Drop the old constraint (Postgres names it reports_entity_type_check
  -- by default for a column-level CHECK).
  alter table public.reports drop constraint if exists reports_entity_type_check;
  -- Re-add without group_post.
  alter table public.reports
    add constraint reports_entity_type_check
    check (entity_type in ('post', 'job', 'business', 'profile'));
  -- Clean up any existing group_post reports so the new constraint holds.
  delete from public.reports where entity_type = 'group_post';
exception
  when undefined_table then null; -- reports table doesn't exist yet
end $$;


-- ============================================================
-- Migration 41  (schema-update-41.sql)
-- ============================================================
-- ============================================================
-- Update 41: In-app job applications
-- Adds job_applications table + private storage bucket for CVs
-- and cover letters. Run in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.job_applications (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.jobs(id) on delete cascade,
  applicant_id uuid not null references auth.users(id) on delete cascade,
  cover_letter text not null default '',
  cv_url text,
  cv_name text,
  cover_letter_url text,
  cover_letter_name text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (job_id, applicant_id)
);

alter table public.job_applications enable row level security;

create policy "Approved members can apply to jobs"
  on public.job_applications for insert to authenticated
  with check (applicant_id = auth.uid() and public.is_approved());

create policy "Users can view own applications"
  on public.job_applications for select to authenticated
  using (applicant_id = auth.uid());

create policy "Posters can view applications to their jobs"
  on public.job_applications for select to authenticated
  using (exists (
    select 1 from public.jobs
    where jobs.id = job_applications.job_id and jobs.posted_by = auth.uid()
  ));

create policy "Users can withdraw own applications"
  on public.job_applications for delete to authenticated
  using (applicant_id = auth.uid());

-- Private storage bucket for CVs and cover letter documents
insert into storage.buckets (id, name, public)
values ('job-application-files', 'job-application-files', false)
on conflict (id) do nothing;

create policy "Approved members can upload application files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'job-application-files'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

create policy "Authenticated users can read application files"
  on storage.objects for select to authenticated
  using (bucket_id = 'job-application-files');

create policy "Users can delete own application files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'job-application-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

alter publication supabase_realtime add table public.job_applications;


-- ============================================================
-- Migration 42  (schema-update-42.sql)
-- ============================================================
-- ============================================================
-- Update 42: Fix delete_message() silently failing
-- Run in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- delete_message() (schema-update-33.sql) soft-deletes a message by setting
-- content = '' and deleted_at = now(). But messages_content_check
-- (char_length(content) between 1 and 4000, from schema.sql) rejects empty
-- strings on UPDATE just as it would on INSERT — every delete_message()
-- call was failing with a check-constraint violation, which is why
-- "delete message" appeared to do nothing (the RPC errored, the row never
-- changed, no realtime UPDATE ever fired).
--
-- Relax the constraint to allow empty content only on rows that are
-- already marked deleted, so normal (non-deleted) messages still can't be
-- blank.
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check
  check (deleted_at is not null or char_length(content) between 1 and 4000);


-- ============================================================
-- Migration 43  (schema-update-43.sql)
-- ============================================================
-- Update 43: Remove Merchandise feature entirely
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Full rip-out of the Merchandise/store feature added in
-- schema-update-27.sql (merchandise) and schema-update-31.sql
-- (merch_wishlist): both tables, their storage bucket, and every
-- storage policy scoped to that bucket. Same shape as the Photos and
-- Groups removals (schema-update-39/40.sql).

-- Wishlist first — it has an FK to merchandise, though `drop table ...
-- cascade` below would handle it anyway; being explicit keeps the intent
-- clear.
drop table if exists public.merch_wishlist;
drop table if exists public.merchandise cascade;

-- Storage: drop the policies scoped to merch-images. Supabase blocks
-- direct SQL deletes on storage.objects/buckets (same as the Groups
-- removal in schema-update-40.sql) — empty the bucket from the Supabase
-- dashboard (Storage tab) or the Storage API, then uncomment the lines
-- below to drop it:
drop policy if exists "Public can view merch images" on storage.objects;
drop policy if exists "Admins can upload merch images" on storage.objects;
drop policy if exists "Admins can update merch images" on storage.objects;
drop policy if exists "Admins can delete merch images" on storage.objects;

-- delete from storage.objects where bucket_id = 'merch-images';
-- delete from storage.buckets where id = 'merch-images';


-- ============================================================
-- Migration 44  (schema-update-44.sql)
-- ============================================================
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


-- ============================================================
-- Migration 45  (schema-update-45.sql)
-- ============================================================
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


-- ============================================================
-- Migration 46  (schema-update-46.sql)
-- ============================================================
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


-- ============================================================
-- Migration 47  (schema-update-47.sql)
-- ============================================================
-- schema-update-47.sql — security fixes from BREAKAGE_AUDIT_2026_08_01.md
--
-- Covers H2, H3, H4, H5, M1, M2, M3, M9, M10 and L2.
-- Safe to re-run: every statement is guarded or uses "if exists"/"if not exists".
--
-- APPLIED to the live project on 2026-08-01. See also:
--   schema-update-48.sql — performance (M8)
--   schema-update-49.sql — the EXECUTE revokes this file got wrong (see M10 note
--                          at the bottom: revoking from `anon` alone doesn't
--                          remove the default PUBLIC grant that anon inherits)
--
-- H1 (the missing post-videos bucket) is NOT fixed here — video posting is
-- switched off in the app instead (VIDEO_UPLOADS_ENABLED in Feed.jsx). To turn
-- it on later, run this:
--
--   insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--   values ('post-videos','post-videos', true, 52428800,
--           array['video/mp4','video/webm','video/quicktime']);
--
--   create policy "Approved members can upload post videos" on storage.objects
--     for insert to authenticated with check (
--       bucket_id = 'post-videos'
--       and (storage.foldername(name))[1] = (auth.uid())::text
--       and public.is_approved());
--
--   create policy "Users can delete own post videos" on storage.objects
--     for delete to authenticated using (
--       bucket_id = 'post-videos'
--       and (storage.foldername(name))[1] = (auth.uid())::text);

-- ---------------------------------------------------------------------------
-- H2. CVs stay visible to approved members, but stop being readable by the
-- whole internet.
--
-- The bucket was `public = true` with no size limit, no mime restriction, and
-- a SELECT policy of `USING (bucket_id = 'cvs')` — so any signed-in member
-- could list() the entire bucket, and anyone at all could fetch a CV from its
-- URL with no authentication whatsoever. CVs carry home addresses, phone
-- numbers and employment history.
--
-- Intent (confirmed): members SHOULD be able to read each other's CVs. So the
-- read policy stays broad — it's now gated on is_approved() instead of "any
-- authenticated session", and the bucket goes private so the only way in is a
-- short-lived signed URL minted for a real member (see openStorageFile() in
-- src/supabaseClient.js). Size + mime limits match what Profile.jsx already
-- enforces client-side (10 MB, PDF/Word).
-- ---------------------------------------------------------------------------
update storage.buckets
set public             = false,
    file_size_limit    = 10485760, -- 10 MB, matches MAX_CV_SIZE in Profile.jsx
    allowed_mime_types = array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
where id = 'cvs';

drop policy if exists "Anyone can read CVs" on storage.objects;

create policy "Approved members can read CVs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cvs'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text  -- always your own
      or public.is_approved()
      or public.is_admin()
    )
  );

-- Uploads were unrestricted by approval state too — bring them in line with
-- every other bucket in the project.
drop policy if exists "Users can upload their own CV" on storage.objects;
create policy "Users can upload their own CV"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- H3. Job application files were readable by every signed-in member.
--
-- Two permissive SELECT policies existed side by side; permissive policies are
-- OR'd, so the broad one ("Authenticated users can read application files",
-- USING bucket_id = '...') completely overrode the correctly-scoped one. Any
-- member could list() the bucket and sign a URL for anyone's CV or cover
-- letter, including applications to jobs they had nothing to do with.
--
-- Now: you can read your own files, or files attached to an application for a
-- job you posted. Nothing else.
-- ---------------------------------------------------------------------------
drop policy if exists "Authenticated users can read application files" on storage.objects;

create policy "Posters can read applications to their jobs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'job-application-files'
    and exists (
      select 1
      from public.job_applications a
      join public.jobs j on j.id = a.job_id
      where j.posted_by = auth.uid()
        and (a.cv_url = storage.objects.name
             or a.cover_letter_url = storage.objects.name)
    )
  );

-- ("Users can read own application files" already exists and is correct —
--  left in place, it's the other half of the OR.)

-- ---------------------------------------------------------------------------
-- M3. Avatars could never actually be deleted.
--
-- storage.objects had INSERT and UPDATE policies for the avatars bucket but no
-- DELETE policy, so all three .remove() calls in Profile.jsx (old avatar after
-- a re-crop, "Remove photo", and the preserved `original`) were silently
-- refused. "Remove photo" cleared avatar_url in the UI while leaving the image
-- publicly downloadable at its URL forever, and every re-crop leaked another
-- orphaned file.
-- ---------------------------------------------------------------------------
create policy "Users can delete own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- H4. get_profile_contact() bypassed the approval gate.
--
-- schema-update-46 put is_approved() behind every SELECT policy, but this
-- SECURITY DEFINER function reads auth.users.email and profiles.phone/city/
-- country for an arbitrary uuid without checking anything. Since signup is
-- self-service, anyone could create an account, skip verification entirely,
-- and POST /rest/v1/rpc/get_profile_contact for every member id to harvest
-- email addresses and phone numbers.
--
-- Guarded the same way get_or_create_conversation() already is. Reading your
-- OWN contact details still works while pending, which is what the profile
-- screens need.
-- ---------------------------------------------------------------------------
create or replace function public.get_profile_contact(target_id uuid)
returns table(phone text, email text, city text, country text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text; v_privacy_phone text;
  v_email text; v_privacy_email text;
  v_city text; v_country text; v_privacy_location text;
  v_is_self boolean;
begin
  v_is_self := (target_id = auth.uid());

  -- Approval gate. Your own details are always readable (the pending screens
  -- need them); anyone else's requires a verified account.
  if not v_is_self and not public.is_approved() and not public.is_admin() then
    raise exception 'Account not yet approved';
  end if;

  select p.phone, p.privacy_phone, p.city, p.country, p.privacy_location
    into v_phone, v_privacy_phone, v_city, v_country, v_privacy_location
    from public.profiles p where p.id = target_id;

  select u.email, pr.privacy_email into v_email, v_privacy_email
    from auth.users u
    join public.profiles pr on pr.id = u.id
    where u.id = target_id;

  if v_is_self then
    return query select v_phone, v_email, v_city, v_country;
    return;
  end if;

  if v_privacy_phone = 'hide' then v_phone := null; end if;
  if v_privacy_email = 'hide' then v_email := null; end if;
  if v_privacy_location = 'hide' then v_city := null; v_country := null; end if;

  return query select v_phone, v_email, v_city, v_country;
end;
$function$;

-- ---------------------------------------------------------------------------
-- H5. Job posters were never notified about applications.
--
-- ApplyModal.jsx did a client-side insert into `notifications`, but that table
-- has no INSERT policy for `authenticated` — every notification in this app is
-- written by a SECURITY DEFINER trigger. So the insert was rejected by RLS on
-- every single application, invisibly (the .catch() couldn't fire, because a
-- supabase-js query builder resolves with {error} rather than rejecting).
--
-- Same shape as the other notify_* triggers, including honouring the
-- recipient's notification preference.
-- ---------------------------------------------------------------------------
create or replace function public.notify_job_application()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_poster uuid;
  v_title text;
  v_actor_name text;
begin
  select posted_by, title into v_poster, v_title
    from public.jobs where id = new.job_id;
  if v_poster is null or v_poster = new.applicant_id then return new; end if;

  select full_name into v_actor_name
    from public.profiles where id = new.applicant_id;

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (
    v_poster, new.applicant_id, 'job_application', 'job', new.job_id,
    coalesce(v_actor_name, 'Someone') || ' applied to your "'
      || coalesce(v_title, 'listing') || '" listing.'
  );

  return new;
exception when others then
  -- Never let a notification failure take down the application itself.
  raise warning 'notify_job_application failed for % — %', new.id, sqlerrm;
  return new;
end;
$function$;

drop trigger if exists trg_notify_job_application on public.job_applications;
create trigger trg_notify_job_application
  after insert on public.job_applications
  for each row execute function public.notify_job_application();

-- ---------------------------------------------------------------------------
-- M1. Withdrawn applications never disappeared in realtime.
--
-- JobApplications.jsx subscribes to DELETE with `filter: job_id=eq.<id>`, but
-- with REPLICA IDENTITY DEFAULT a delete payload only carries primary-key
-- columns. job_applications' PK is `id`, so job_id was never in the payload
-- and the filter could never match — the listener simply never fired.
--
-- FULL replicates the whole old row so the filter works. This table is
-- low-volume, so the extra WAL is negligible.
-- ---------------------------------------------------------------------------
alter table public.job_applications replica identity full;

-- ---------------------------------------------------------------------------
-- M2. delete_own_account() was a live landmine.
--
-- schema-update-3.sql marked it SUPERSEDED and supabaseClient.js documents it
-- as a silent no-op, yet it still existed and was EXECUTE-able by every signed
-- in user — any future call would return success and delete nothing. Real
-- self-service deletion goes through the delete-account Edge Function, which
-- uses the Admin API and also cleans up storage.
-- ---------------------------------------------------------------------------
drop function if exists public.delete_own_account();

-- ---------------------------------------------------------------------------
-- L2. job_applications.applicant_id carried two foreign keys — one to
-- auth.users and one to profiles. The PostgREST embed only resolves today
-- because exactly one of them targets `profiles`; add a second and every
-- application query breaks with an ambiguity error. profiles.id itself
-- cascades from auth.users, so the auth.users one is redundant.
-- ---------------------------------------------------------------------------
alter table public.job_applications
  drop constraint if exists job_applications_applicant_id_fkey;

-- ---------------------------------------------------------------------------
-- M9. Orphan storage buckets left behind by removed features (Groups and
-- Merchandise, both ripped out on 2026-07-28). They were still public write
-- targets with no owning feature.
--
-- NOTE: Postgres refuses a direct DELETE against storage.objects —
-- storage.protect_delete() raises "Direct deletion from storage tables is not
-- allowed. Use the Storage API instead." So this part is NOT done in SQL.
-- Buckets with no objects can be dropped from storage.buckets directly (below);
-- anything with files in it has to go via the dashboard (Storage → bucket →
-- Delete bucket) or the Storage API.
-- ---------------------------------------------------------------------------
delete from storage.buckets
where id in ('group-covers', 'group-post-images', 'merch-images')
  and not exists (
    select 1 from storage.objects o where o.bucket_id = storage.buckets.id
  );

-- ---------------------------------------------------------------------------
-- M10. Six SECURITY DEFINER functions were callable by the anonymous role.
--
-- Nothing leaked today — admin_list_members() raises 'Admins only' internally
-- and the trigger functions fail on a null NEW. But admin_list_members()
-- returns every member's email address, and the only thing standing between
-- `anon` and that was one internal `if`. Remove the standing exposure.
-- ---------------------------------------------------------------------------
revoke execute on function public.admin_list_members()                    from anon;
revoke execute on function public.is_admin()                              from anon;
revoke execute on function public.is_approved()                           from anon;
revoke execute on function public.is_participant(bigint, uuid)            from anon;
revoke execute on function public.notify_admins_new_signup()              from anon;
revoke execute on function public.prevent_last_admin_demotion()           from anon;

-- Trigger functions have no business being callable over the REST API at all.
revoke execute on function public.handle_new_user()          from anon, authenticated;
revoke execute on function public.notify_admins_new_signup() from authenticated;
revoke execute on function public.notify_event_comment()     from anon, authenticated;
revoke execute on function public.notify_event_rsvp()        from anon, authenticated;
revoke execute on function public.notify_new_message()       from anon, authenticated;
revoke execute on function public.notify_post_comment()      from anon, authenticated;
revoke execute on function public.notify_post_like()         from anon, authenticated;
revoke execute on function public.notify_job_application()   from anon, authenticated;
revoke execute on function public.prevent_last_admin_demotion() from authenticated;


-- ============================================================
-- Migration 48  (schema-update-48.sql)
-- ============================================================
-- schema-update-48.sql — performance fixes (M8) from BREAKAGE_AUDIT_2026_08_01.md
--
-- Three things, all flagged by Supabase's performance linter:
--
--   1. 16 foreign keys with no covering index. Every "things belonging to this
--      person" lookup and every member deletion was a sequential scan.
--   2. 47 policies calling auth.uid() / is_approved() / is_admin() once PER ROW.
--      Wrapping the call in a scalar subquery — (select auth.uid()) — turns it
--      into an InitPlan that Postgres evaluates once per query instead.
--   3. 8 tables with two permissive policies for the same role+action (e.g. an
--      "admins can delete any" and an "authors can delete own" pair). Both get
--      evaluated for every row; merged into one policy with an OR, which is
--      exactly what permissive policies already mean.
--
-- IMPORTANT: this only changes HOW the policies are evaluated, never WHO they
-- let in. Every USING/WITH CHECK expression below is logically identical to
-- what it replaces. Invisible at 4 members; very visible at 400.
--
-- Safe to re-run.

-- ===========================================================================
-- 1. Covering indexes for foreign keys
-- ===========================================================================
create index if not exists post_likes_user_id_idx          on public.post_likes (user_id);
create index if not exists post_comments_post_id_idx       on public.post_comments (post_id);
create index if not exists post_comments_author_id_idx     on public.post_comments (author_id);
create index if not exists posts_author_id_idx             on public.posts (author_id);
create index if not exists events_created_by_idx           on public.events (created_by);
create index if not exists event_rsvps_user_id_idx         on public.event_rsvps (user_id);
create index if not exists event_comments_event_id_idx     on public.event_comments (event_id);
create index if not exists event_comments_author_id_idx    on public.event_comments (author_id);
create index if not exists jobs_posted_by_idx              on public.jobs (posted_by);
create index if not exists job_applications_job_id_idx     on public.job_applications (job_id);
create index if not exists job_applications_applicant_idx  on public.job_applications (applicant_id);
create index if not exists saved_jobs_user_id_idx          on public.saved_jobs (user_id);
create index if not exists saved_events_user_id_idx        on public.saved_events (user_id);
create index if not exists notifications_actor_id_idx      on public.notifications (actor_id);
create index if not exists notifications_user_id_idx       on public.notifications (user_id);
create index if not exists reports_reporter_id_idx         on public.reports (reporter_id);
create index if not exists reports_reviewed_by_idx         on public.reports (reviewed_by);
create index if not exists message_reactions_user_id_idx   on public.message_reactions (user_id);
create index if not exists messages_conversation_id_idx    on public.messages (conversation_id);
create index if not exists conv_participants_user_id_idx   on public.conversation_participants (user_id);
create index if not exists businesses_owner_id_idx         on public.businesses (owner_id);

-- ===========================================================================
-- 2 + 3. Policy rewrites — InitPlan wrapping, and merging duplicate pairs
-- ===========================================================================

-- ---------------------------------------------------------------- businesses
drop policy if exists "Approved members can read businesses"   on public.businesses;
drop policy if exists "Approved members can list a business"    on public.businesses;
drop policy if exists "Owners and admins can update a business" on public.businesses;
drop policy if exists "Owners and admins can delete a business" on public.businesses;

create policy "Approved members can read businesses" on public.businesses
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can list a business" on public.businesses
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_approved()));

create policy "Owners and admins can update a business" on public.businesses
  for update to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()))
  with check (owner_id = (select auth.uid()) or (select public.is_admin()));

create policy "Owners and admins can delete a business" on public.businesses
  for delete to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));

-- --------------------------------------------------- conversations / members
drop policy if exists "Participants can view conversations"    on public.conversations;
drop policy if exists "Participants can view participant rows" on public.conversation_participants;

create policy "Participants can view conversations" on public.conversations
  for select to authenticated
  using (public.is_participant(id, (select auth.uid())));

create policy "Participants can view participant rows" on public.conversation_participants
  for select to authenticated
  using (public.is_participant(conversation_id, (select auth.uid())));

-- ------------------------------------------------------------- event_comments
-- Merges "Admins can delete any event comment" + "Authors can delete own".
drop policy if exists "Approved members can read event comments" on public.event_comments;
drop policy if exists "Approved members can comment on events"   on public.event_comments;
drop policy if exists "Admins can delete any event comment"      on public.event_comments;
drop policy if exists "Authors can delete own event comments"    on public.event_comments;

create policy "Approved members can read event comments" on public.event_comments
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can comment on events" on public.event_comments
  for insert to authenticated
  with check (author_id = (select auth.uid()) and (select public.is_approved()));

create policy "Authors and admins can delete event comments" on public.event_comments
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

-- ---------------------------------------------------------------- event_rsvps
drop policy if exists "Approved members can read rsvps" on public.event_rsvps;
drop policy if exists "Approved members can rsvp"       on public.event_rsvps;
drop policy if exists "Users can cancel own rsvp"       on public.event_rsvps;

create policy "Approved members can read rsvps" on public.event_rsvps
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can rsvp" on public.event_rsvps
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_approved()));

create policy "Users can cancel own rsvp" on public.event_rsvps
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------- events
-- Merges "Admins can delete any event" + "Creators can delete own events".
drop policy if exists "Approved members can read events"   on public.events;
drop policy if exists "Approved members can create events" on public.events;
drop policy if exists "Creators can update own events"     on public.events;
drop policy if exists "Admins can delete any event"        on public.events;
drop policy if exists "Creators can delete own events"     on public.events;

create policy "Approved members can read events" on public.events
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can create events" on public.events
  for insert to authenticated
  with check (created_by = (select auth.uid()) and (select public.is_approved()));

-- Admins can now edit as well as delete — previously they could delete any
-- event but not correct a typo in one, which made no sense for moderation.
create policy "Creators and admins can update events" on public.events
  for update to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()))
  with check (created_by = (select auth.uid()) or (select public.is_admin()));

create policy "Creators and admins can delete events" on public.events
  for delete to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));

-- ----------------------------------------------------------- job_applications
-- Merges "Users can view own applications" + "Posters can view applications
-- to their jobs".
drop policy if exists "Users can view own applications"              on public.job_applications;
drop policy if exists "Posters can view applications to their jobs"  on public.job_applications;
drop policy if exists "Approved members can apply to jobs"           on public.job_applications;
drop policy if exists "Users can withdraw own applications"          on public.job_applications;

create policy "Applicants and posters can view applications" on public.job_applications
  for select to authenticated
  using (
    applicant_id = (select auth.uid())
    or exists (
      select 1 from public.jobs j
      where j.id = job_applications.job_id and j.posted_by = (select auth.uid())
    )
  );

create policy "Approved members can apply to jobs" on public.job_applications
  for insert to authenticated
  with check (applicant_id = (select auth.uid()) and (select public.is_approved()));

create policy "Users can withdraw own applications" on public.job_applications
  for delete to authenticated
  using (applicant_id = (select auth.uid()));

-- ----------------------------------------------------------------------- jobs
-- Merges "Admins can delete any job" + "Posters can delete own jobs".
drop policy if exists "Approved members can read jobs" on public.jobs;
drop policy if exists "Approved members can post jobs" on public.jobs;
drop policy if exists "Posters can update own jobs"    on public.jobs;
drop policy if exists "Admins can delete any job"      on public.jobs;
drop policy if exists "Posters can delete own jobs"    on public.jobs;

create policy "Approved members can read jobs" on public.jobs
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can post jobs" on public.jobs
  for insert to authenticated
  with check (posted_by = (select auth.uid()) and (select public.is_approved()));

create policy "Posters and admins can update jobs" on public.jobs
  for update to authenticated
  using (posted_by = (select auth.uid()) or (select public.is_admin()))
  with check (posted_by = (select auth.uid()) or (select public.is_admin()));

create policy "Posters and admins can delete jobs" on public.jobs
  for delete to authenticated
  using (posted_by = (select auth.uid()) or (select public.is_admin()));

-- ------------------------------------------------------------ message_reactions
drop policy if exists "Participants can read reactions" on public.message_reactions;
drop policy if exists "Participants can react"          on public.message_reactions;
drop policy if exists "Users can remove own reactions"  on public.message_reactions;

create policy "Participants can read reactions" on public.message_reactions
  for select to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and public.is_participant(m.conversation_id, (select auth.uid()))
  ));

create policy "Participants can react" on public.message_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and public.is_participant(m.conversation_id, (select auth.uid()))
        and m.deleted_at is null
    )
  );

create policy "Users can remove own reactions" on public.message_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------------- messages
drop policy if exists "Participants can read messages"          on public.messages;
drop policy if exists "Approved participants can send messages" on public.messages;
drop policy if exists "Senders can update own messages"         on public.messages;

create policy "Participants can read messages" on public.messages
  for select to authenticated
  using (public.is_participant(conversation_id, (select auth.uid())));

create policy "Approved participants can send messages" on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_participant(conversation_id, (select auth.uid()))
    and (select public.is_approved())
  );

create policy "Senders can update own messages" on public.messages
  for update to authenticated
  using (sender_id = (select auth.uid()))
  with check (sender_id = (select auth.uid()));

-- ------------------------------------------------------ notification_preferences
drop policy if exists "Users can read own notification prefs"   on public.notification_preferences;
drop policy if exists "Users can upsert own notification prefs" on public.notification_preferences;
drop policy if exists "Users can update own notification prefs" on public.notification_preferences;

create policy "Users can read own notification prefs" on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Users can upsert own notification prefs" on public.notification_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "Users can update own notification prefs" on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -------------------------------------------------------------- notifications
drop policy if exists "Users can read own notifications"      on public.notifications;
drop policy if exists "Users can mark own notifications read" on public.notifications;

create policy "Users can read own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Users can mark own notifications read" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -------------------------------------------------------------- post_comments
-- Merges "Admins can delete any comment" + "Authors can delete own comments".
drop policy if exists "Approved members can read comments" on public.post_comments;
drop policy if exists "Approved members can comment"       on public.post_comments;
drop policy if exists "Admins can delete any comment"      on public.post_comments;
drop policy if exists "Authors can delete own comments"    on public.post_comments;

create policy "Approved members can read comments" on public.post_comments
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can comment" on public.post_comments
  for insert to authenticated
  with check (author_id = (select auth.uid()) and (select public.is_approved()));

create policy "Authors and admins can delete comments" on public.post_comments
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

-- ----------------------------------------------------------------- post_likes
drop policy if exists "Approved members can read likes" on public.post_likes;
drop policy if exists "Approved members can like"       on public.post_likes;
drop policy if exists "Users can unlike"                on public.post_likes;

create policy "Approved members can read likes" on public.post_likes
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can like" on public.post_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_approved()));

create policy "Users can unlike" on public.post_likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------- posts
-- Merges both the DELETE pair and the UPDATE pair.
drop policy if exists "Approved members can read posts" on public.posts;
drop policy if exists "Approved members can post"       on public.posts;
drop policy if exists "Admins can update any post"      on public.posts;
drop policy if exists "Authors can update own posts"    on public.posts;
drop policy if exists "Admins can delete any post"      on public.posts;
drop policy if exists "Authors can delete own posts"    on public.posts;

create policy "Approved members can read posts" on public.posts
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can post" on public.posts
  for insert to authenticated
  with check (author_id = (select auth.uid()) and (select public.is_approved()));

create policy "Authors and admins can update posts" on public.posts
  for update to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()))
  with check (author_id = (select auth.uid()) or (select public.is_admin()));

create policy "Authors and admins can delete posts" on public.posts
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

-- ------------------------------------------------------------------- profiles
-- Deliberately NOT merged: the two UPDATE policies have materially different
-- WITH CHECK clauses (the admin one enforces the consent gate from
-- schema-update-45; the self one pins `approved` and `is_admin` to their
-- current values so nobody can promote themselves). Keeping them apart keeps
-- each rule readable and independently auditable.
drop policy if exists "Approved members can view profiles" on public.profiles;
drop policy if exists "Users can update own profile"       on public.profiles;
drop policy if exists "Admins can update any profile"      on public.profiles;

create policy "Approved members can view profiles" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_approved())
    or (select public.is_admin())
  );

create policy "Users can update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and approved = (select p.approved from public.profiles p where p.id = (select auth.uid()))
    and is_admin = (select p.is_admin from public.profiles p where p.id = (select auth.uid()))
  );

create policy "Admins can update any profile" on public.profiles
  for update to authenticated
  using ((select public.is_admin()))
  with check (
    (select public.is_admin())
    and (approved = false or consented_at is not null)
    and (is_admin  = false or consented_at is not null)
  );

-- -------------------------------------------------------------------- reports
drop policy if exists "Reporters and admins can read reports" on public.reports;
drop policy if exists "Members can file reports"              on public.reports;
drop policy if exists "Admins can update reports"             on public.reports;

create policy "Reporters and admins can read reports" on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or (select public.is_admin()));

create policy "Members can file reports" on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()));

create policy "Admins can update reports" on public.reports
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- --------------------------------------------------------------- saved_events
drop policy if exists "Users can read own saved events" on public.saved_events;
drop policy if exists "Users can save events"           on public.saved_events;
drop policy if exists "Users can unsave events"         on public.saved_events;

create policy "Users can read own saved events" on public.saved_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can save events" on public.saved_events
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can unsave events" on public.saved_events
  for delete to authenticated using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------- saved_jobs
drop policy if exists "Users can read own saved jobs" on public.saved_jobs;
drop policy if exists "Users can save jobs"           on public.saved_jobs;
drop policy if exists "Users can unsave jobs"         on public.saved_jobs;

create policy "Users can read own saved jobs" on public.saved_jobs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can save jobs" on public.saved_jobs
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can unsave jobs" on public.saved_jobs
  for delete to authenticated using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------- badges
-- Was `using (true)` for anyone signed in. Badge definitions aren't secret,
-- but there's no reason an unverified account needs them either.
drop policy if exists "Members can view badges" on public.badges;
create policy "Members can view badges" on public.badges
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));


-- ============================================================
-- Migration 49  (schema-update-49.sql)
-- ============================================================
-- schema-update-49.sql — fixes the EXECUTE revokes that schema-update-47 got wrong.
--
-- APPLIED to the live project on 2026-08-01.
--
-- 47 did `revoke execute ... from anon`, re-ran the Supabase security linter,
-- and the same "Public Can Execute SECURITY DEFINER Function" warnings were
-- still there. The reason: Postgres grants EXECUTE on every new function to
-- PUBLIC by default (it shows up in pg_proc.proacl as a bare `=X/postgres`
-- entry). `anon` inherits that, so revoking from `anon` by name changes
-- nothing at all — you have to revoke from PUBLIC.
--
-- CRITICAL, and the reason this file grants some things straight back:
-- is_admin(), is_approved() and is_participant() MUST keep their EXECUTE grant
-- for `authenticated`. RLS policy expressions are evaluated with the
-- privileges of the querying role, not the policy owner — so revoking these
-- from authenticated would make every policy that calls them fail with
-- "permission denied for function", i.e. take the entire site down. Only the
-- PUBLIC/anon path is being closed.
--
-- Verified afterwards by querying as a real approved member (sees all
-- profiles, badges, own notifications/messages) and as an unapproved one
-- (sees nothing) — no permission errors either way.

revoke execute on function public.is_admin()                    from public;
revoke execute on function public.is_approved()                 from public;
revoke execute on function public.is_participant(bigint, uuid)  from public;
grant  execute on function public.is_admin()                    to authenticated;
grant  execute on function public.is_approved()                 to authenticated;
grant  execute on function public.is_participant(bigint, uuid)  to authenticated;

-- Admin-only and guarded internally, but no reason for it to be reachable
-- without a session — it returns every member's email address.
revoke execute on function public.admin_list_members() from public;
grant  execute on function public.admin_list_members() to authenticated;

-- Trigger functions. These run as the trigger owner when the trigger fires, so
-- nothing needs EXECUTE on them — being callable over /rest/v1/rpc at all was
-- pure surface area.
revoke execute on function public.notify_admins_new_signup()    from public, anon, authenticated;
revoke execute on function public.prevent_last_admin_demotion() from public, anon, authenticated;
revoke execute on function public.notify_job_application()      from public, anon, authenticated;
revoke execute on function public.notify_event_comment()        from public, anon, authenticated;
revoke execute on function public.notify_event_rsvp()           from public, anon, authenticated;
revoke execute on function public.notify_new_message()          from public, anon, authenticated;
revoke execute on function public.notify_post_comment()         from public, anon, authenticated;
revoke execute on function public.notify_post_like()            from public, anon, authenticated;
revoke execute on function public.handle_new_user()             from public, anon, authenticated;

-- Member-facing RPCs: signed-in only, never anonymous.
revoke execute on function public.get_profile_contact(uuid)                  from public;
revoke execute on function public.get_or_create_conversation(uuid)           from public;
revoke execute on function public.unread_message_count()                     from public;
revoke execute on function public.mark_conversation_read(bigint)             from public;
revoke execute on function public.last_messages_for_conversations(bigint[])  from public;
revoke execute on function public.edit_message(bigint, text)                 from public;
revoke execute on function public.delete_message(bigint)                     from public;
revoke execute on function public.admin_delete_member(uuid)                  from public;

grant execute on function public.get_profile_contact(uuid)                  to authenticated;
grant execute on function public.get_or_create_conversation(uuid)           to authenticated;
grant execute on function public.unread_message_count()                     to authenticated;
grant execute on function public.mark_conversation_read(bigint)             to authenticated;
grant execute on function public.last_messages_for_conversations(bigint[])  to authenticated;
grant execute on function public.edit_message(bigint, text)                 to authenticated;
grant execute on function public.delete_message(bigint)                     to authenticated;

-- admin_delete_member() is now DEAD CODE — the Admin screen calls the
-- admin-delete-member Edge Function instead, because this function's raw
-- `delete from auth.users` rests on the exact mechanism the codebase's own
-- comments call unreliable on hosted Supabase, and because it did no storage
-- cleanup (an admin-deleted member left their CV and photos in public buckets).
-- Left in place, but locked to signed-in callers only, so nothing breaks if the
-- Edge Function deploy is delayed. Safe to drop once that's deployed and tested:
--
--   drop function if exists public.admin_delete_member(uuid);
grant execute on function public.admin_delete_member(uuid) to authenticated;


-- ============================================================
-- Migration 50  (schema-update-50.sql)
-- ============================================================
-- schema-update-50.sql — fixes infinite-recursion bug in profiles UPDATE RLS
-- from schema-update-48.
--
-- APPLIED to the live project on 2026-08-01 (via Supabase MCP, migration
-- fix_profiles_update_rls_recursion).
--
-- schema-update-48's "Users can update own profile" policy pinned
-- approved/is_admin to their current values via a subquery against
-- public.profiles itself:
--
--   approved = (select p.approved from public.profiles p where p.id = auth.uid())
--
-- That subquery is evaluated as the querying role (authenticated), which
-- means it re-enters profiles' own RLS mid-evaluation of the UPDATE's RLS —
-- Postgres refuses this with "42P17: infinite recursion detected in policy
-- for relation \"profiles\"". This wasn't limited to admin actions: it broke
-- EVERY update to the profiles table, because Postgres evaluates all
-- applicable policy expressions (not just the one that ends up mattering)
-- when combining permissive policies. Confirmed broken: Admin.jsx's "Make
-- admin" / "Remove admin" buttons, the last_seen heartbeat in App.jsx
-- (line ~424), and every Settings.jsx save (language, and the generic
-- key/value profile field save) — all were silently 500ing.
--
-- Fix: move the "non-admins can't touch their own approved/is_admin" rule
-- out of RLS (where it required a self-referential subquery) and into a
-- BEFORE UPDATE trigger, which compares OLD/NEW column values directly with
-- no subquery and no RLS re-entry — the same pattern already used by
-- prevent_last_admin_demotion in schema-update-46.

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create or replace function public.prevent_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    if new.approved is distinct from old.approved then
      raise exception 'Only an admin can change approval status.';
    end if;
    if new.is_admin is distinct from old.is_admin then
      raise exception 'Only an admin can change admin status.';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists on_self_privilege_escalation on public.profiles;
create trigger on_self_privilege_escalation
  before update of approved, is_admin on public.profiles
  for each row execute function public.prevent_self_privilege_escalation();

-- Trigger functions don't need EXECUTE granted to anyone (same reasoning as
-- schema-update-49): they run as the trigger owner when the trigger fires,
-- so being callable over /rest/v1/rpc at all is pure surface area.
revoke execute on function public.prevent_self_privilege_escalation() from public, anon, authenticated;


-- ============================================================
-- Migration 51  (schema-update-51.sql)
-- ============================================================
-- schema-update-51.sql
-- Fixes from the 2026-08-01 feature/UI audit (FEATURE_AUDIT_2026_08_01.md).
-- Already applied to the hosted project as migration
-- `schema_update_51_audit_fixes`; kept here so the repo's schema history
-- stays complete.

-- ---------------------------------------------------------------------------
-- 1. Applications to a closed listing
-- ---------------------------------------------------------------------------
-- Jobs.jsx hid the Apply button once isJobClosed() was true, but JobDetail.jsx
-- checked only "not mine" and "not already applied" — so anyone reaching a
-- closed listing directly (saved link, share, bookmark) could still submit,
-- and ApplyModal trusted its caller completely. Both now gate it client-side;
-- this is the check that actually enforces it.
--
-- Africa/Johannesburg rather than UTC deliberately: it mirrors the local-day
-- comparison isJobClosed() makes in the browser, so a listing closing today
-- stays open for the whole SA working day instead of expiring at 02:00.
drop policy if exists "Approved members can apply to jobs" on public.job_applications;
create policy "Approved members can apply to jobs"
  on public.job_applications
  for insert
  to authenticated
  with check (
    applicant_id = (select auth.uid())
    and (select public.is_approved())
    and not exists (
      select 1 from public.jobs j
      where j.id = job_applications.job_id
        and j.closing_date is not null
        and j.closing_date < (now() at time zone 'Africa/Johannesburg')::date
    )
  );

-- ---------------------------------------------------------------------------
-- 2. is_participant() answered for anybody
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER bypasses RLS inside the function body, and this one took
-- the user id as a parameter — so any authenticated member could call
-- is_participant(<some conversation>, <someone else's uuid>) and get a
-- straight yes/no about who is talking to whom. Every caller is an RLS policy
-- passing auth.uid(), so refusing to answer for anyone else changes no
-- behaviour and closes the oracle.
create or replace function public.is_participant(conv_id bigint, uid uuid)
  returns boolean
  language sql
  security definer
  set search_path to 'public'
as $function$
  select uid = (select auth.uid()) and exists (
    select 1 from public.conversation_participants
    where conversation_id = conv_id and user_id = uid
  );
$function$;

-- ---------------------------------------------------------------------------
-- 3. Duplicate indexes
-- ---------------------------------------------------------------------------
-- Exact duplicates — same table, same column, same method. Both halves of each
-- pair were maintained on every insert/update/delete for no read benefit.
drop index if exists public.businesses_owner_idx;            -- dup of businesses_owner_id_idx
drop index if exists public.conv_participants_user_id_idx;   -- dup of conversation_participants_user_id_idx


-- ============================================================
-- Migration 52  (schema-update-52.sql)
-- ============================================================
-- schema-update-52.sql — admin activity log
--
-- Why this exists: the site is meant to outlive whoever set it up. When the
-- next committee takes over, "who approved this person?" and "who deleted that
-- post?" should be answerable from inside the app, not from memory.
--
-- Everything here is written by database triggers rather than by the app, so
-- the log can't be skipped by a bug in the front end, an admin using the
-- Supabase dashboard directly, or a future refactor that forgets to call it.
--
-- Safe to re-run.

create table if not exists public.admin_actions (
  id            bigserial primary key,
  actor_id      uuid references auth.users(id) on delete set null,
  actor_name    text,            -- snapshotted: the log must survive the actor being deleted
  action        text not null,   -- approve_member | unapprove_member | grant_admin | revoke_admin
                                 -- delete_member | delete_post | delete_job | delete_event
                                 -- delete_business | feature_business | unfeature_business
                                 -- resolve_report | dismiss_report | reopen_report
  target_type   text,            -- member | post | job | event | business | report
  target_id     text,
  target_label  text,            -- name/title snapshot, same reason as actor_name
  details       text,
  created_at    timestamptz not null default now()
);

create index if not exists admin_actions_created_at_idx on public.admin_actions (created_at desc);
create index if not exists admin_actions_actor_idx      on public.admin_actions (actor_id);

alter table public.admin_actions enable row level security;

-- Admins read. Nobody writes directly — only the security-definer triggers
-- below, which run as the table owner and bypass RLS.
drop policy if exists "admins read activity log" on public.admin_actions;
create policy "admins read activity log" on public.admin_actions
  for select using (public.is_admin());

revoke insert, update, delete on public.admin_actions from authenticated, anon;

/* ---------- shared writer ---------- */

create or replace function public.log_admin_action(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_target_label text,
  p_details text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.admin_actions (actor_id, actor_name, action, target_type, target_id, target_label, details)
  values (auth.uid(), coalesce(v_name, 'an admin'), p_action, p_target_type, p_target_id, p_target_label, p_details);
end;
$$;

-- Not callable from the client: every insert path is a trigger.
--
-- Revoking from `authenticated, anon` alone is a no-op — Postgres grants
-- EXECUTE on new functions to PUBLIC, and those roles inherit it rather than
-- holding their own grant. Without the `public` in this list, any signed-in
-- member could POST to /rest/v1/rpc/log_admin_action and forge entries in the
-- one table whose entire value is being trustworthy.
revoke execute on function public.log_admin_action(text, text, text, text, text) from public, anon, authenticated;

/* ---------- membership changes ---------- */

-- Note on the label: `profiles` has no email column — the Admin page gets
-- addresses by joining auth.users inside the admin_list_members RPC. Reaching
-- for new.email here aborts the whole UPDATE with "record new has no field
-- email", which would break approving members entirely. These functions are
-- SECURITY DEFINER, so they read auth.users directly for the fallback.
create or replace function public.log_profile_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  -- Self-service changes aren't admin actions; neither is the initial insert.
  if new.id = auth.uid() then return new; end if;

  if (new.approved is distinct from old.approved) or (new.is_admin is distinct from old.is_admin) then
    v_label := coalesce(
      nullif(new.full_name, ''),
      (select u.email from auth.users u where u.id = new.id),
      'a member'
    );
  end if;

  if new.approved is distinct from old.approved then
    perform public.log_admin_action(
      case when new.approved then 'approve_member' else 'unapprove_member' end,
      'member', new.id::text, v_label, null
    );
  end if;

  if new.is_admin is distinct from old.is_admin then
    perform public.log_admin_action(
      case when new.is_admin then 'grant_admin' else 'revoke_admin' end,
      'member', new.id::text, v_label, null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_profile_admin_change on public.profiles;
create trigger on_profile_admin_change
  after update of approved, is_admin on public.profiles
  for each row execute function public.log_profile_admin_change();

-- Account removal. Fires for admin-initiated deletes only — someone deleting
-- their own account from Settings is not an admin action.
create or replace function public.log_member_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.id = auth.uid() or auth.uid() is null then return old; end if;
  perform public.log_admin_action('delete_member', 'member', old.id::text,
    coalesce(nullif(old.full_name, ''), (select u.email from auth.users u where u.id = old.id), 'a member'),
    'Account and all their content removed');
  return old;
end;
$$;

drop trigger if exists on_member_deleted on public.profiles;
create trigger on_member_deleted
  before delete on public.profiles
  for each row execute function public.log_member_deletion();

/* ---------- content removed by an admin ---------- */
-- Only logged when the person deleting isn't the owner — members tidying up
-- their own posts is normal housekeeping, not moderation.

create or replace function public.log_post_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or old.author_id = auth.uid() then return old; end if;
  perform public.log_admin_action('delete_post', 'post', old.id::text,
    coalesce(nullif(old.title, ''), 'Untitled post'), null);
  return old;
end; $$;

drop trigger if exists on_post_moderated on public.posts;
create trigger on_post_moderated before delete on public.posts
  for each row execute function public.log_post_moderation();

create or replace function public.log_job_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or old.posted_by = auth.uid() then return old; end if;
  perform public.log_admin_action('delete_job', 'job', old.id::text,
    concat_ws(' — ', old.title, old.company), null);
  return old;
end; $$;

drop trigger if exists on_job_moderated on public.jobs;
create trigger on_job_moderated before delete on public.jobs
  for each row execute function public.log_job_moderation();

create or replace function public.log_event_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or old.created_by = auth.uid() then return old; end if;
  perform public.log_admin_action('delete_event', 'event', old.id::text, old.title, null);
  return old;
end; $$;

drop trigger if exists on_event_moderated on public.events;
create trigger on_event_moderated before delete on public.events
  for each row execute function public.log_event_moderation();

create or replace function public.log_business_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or old.owner_id = auth.uid() then return old; end if;
  perform public.log_admin_action('delete_business', 'business', old.id::text, old.name, null);
  return old;
end; $$;

drop trigger if exists on_business_moderated on public.businesses;
create trigger on_business_moderated before delete on public.businesses
  for each row execute function public.log_business_moderation();

create or replace function public.log_business_promotion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.promoted is distinct from old.promoted then
    perform public.log_admin_action(
      case when new.promoted then 'feature_business' else 'unfeature_business' end,
      'business', new.id::text, new.name, null);
  end if;
  return new;
end; $$;

drop trigger if exists on_business_promoted on public.businesses;
create trigger on_business_promoted after update of promoted on public.businesses
  for each row execute function public.log_business_promotion();

/* ---------- reports ---------- */

create or replace function public.log_report_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform public.log_admin_action(
      case new.status when 'reviewed' then 'resolve_report'
                      when 'dismissed' then 'dismiss_report'
                      else 'reopen_report' end,
      'report', new.id::text,
      concat_ws(' ', 'Report on a', new.entity_type), new.reason);
  end if;
  return new;
end; $$;

drop trigger if exists on_report_decided on public.reports;
create trigger on_report_decided after update of status on public.reports
  for each row execute function public.log_report_decision();

/* ---------- keep the trigger functions off the REST surface ---------- */
-- Same PUBLIC-grant reasoning as above. Calling a trigger function directly
-- errors out ("can only be called as a trigger"), so this isn't exploitable —
-- there's just no reason for them to be reachable over the API at all.
revoke execute on function public.log_profile_admin_change()  from public, anon, authenticated;
revoke execute on function public.log_member_deletion()       from public, anon, authenticated;
revoke execute on function public.log_post_moderation()       from public, anon, authenticated;
revoke execute on function public.log_job_moderation()        from public, anon, authenticated;
revoke execute on function public.log_event_moderation()      from public, anon, authenticated;
revoke execute on function public.log_business_moderation()   from public, anon, authenticated;
revoke execute on function public.log_business_promotion()    from public, anon, authenticated;
revoke execute on function public.log_report_decision()       from public, anon, authenticated;


-- ============================================================
-- Migration 53  (schema-update-53.sql)
-- ============================================================
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


-- ============================================================
-- Migration 54  (schema-update-54.sql)
-- ============================================================
-- schema-update-54.sql — Eendrag legends (home-page spotlight)
--
-- A small, admin-curated hall of fame: notable old boys, shown as a photo
-- mosaic on Home. Deliberately NOT derived from `profiles` — the people this
-- is for are mostly long gone and were never members of the hub, so there is
-- no account to hang any of this off. It is reference content, closer to
-- `badges` than to anything member-owned.
--
-- APPLIED to the live project on 2026-08-02, and verified: the category CHECK
-- rejects a typo'd value, and the updated_at trigger fires on UPDATE.
--
-- Safe to re-run: every statement is guarded or uses "if exists"/"if not
-- exists"/"on conflict do nothing".


/* ---------------------------------------------------------------------------
   The table
   ------------------------------------------------------------------------ */
create table if not exists public.legends (
  id          uuid primary key default gen_random_uuid(),

  -- Displayed as the tile headline, in Georgia. Full name as you want it read.
  name        text not null,

  -- Free text, not two integer columns, because the records this is drawn
  -- from are often vague: "1962–1966" for some, "early 1950s" for others.
  -- Forcing a start/end year would mean either inventing precision the
  -- archive doesn't have, or leaving the field empty for the oldest entries —
  -- which are exactly the ones most worth listing.
  years       text,
  degree      text,

  -- Drives the pill colour on the tile (see .legend-pill-* in styles.css).
  -- Constrained rather than free text so the palette can't drift: a typo'd
  -- "Politcs" would silently fall through to the neutral pill and nobody
  -- would notice for months.
  category    text not null default 'other',

  -- The one-line claim to fame, shown under the name on the tile. This is
  -- the line that has to earn the click, so it's required.
  headline    text not null,

  -- Long-form, shown only in the modal. Plain text with newlines, not HTML —
  -- there's no rich-text editor on this form and no reason to open an
  -- injection surface for content that is three paragraphs of prose.
  story       text,

  photo_url   text,

  -- Optional "read more" out to Wikipedia, an obituary, a news piece.
  link_url    text,
  link_label  text,

  -- `active` hides an entry without deleting it — useful when a story turns
  -- out to be wrong or a family asks for it to come down, and you want the
  -- write-up kept in case it comes back.
  active      boolean not null default true,

  -- Lower sorts first. Ties break on created_at so the order is stable.
  sort_order  integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'legends_category_check'
  ) then
    alter table public.legends
      add constraint legends_category_check check (category in (
        'sport', 'business', 'politics', 'arts', 'academia',
        'military', 'medicine', 'media', 'service', 'other'
      ));
  end if;
end $$;

-- The home page only ever asks for "active legends in display order", so the
-- index matches that query exactly rather than indexing each column alone.
create index if not exists legends_active_order_idx
  on public.legends (active, sort_order, created_at);


/* ---------------------------------------------------------------------------
   RLS

   Read is for approved members. This is house history, not public marketing —
   it sits behind the same wall as the directory, and an inactive entry is
   invisible to everyone but admins (see the `active` note above: hiding
   something must actually hide it, or the flag is decorative).

   Write is admin-only. There is no member-submission flow by design; the
   whole point of curating this is that you decide who counts.
   ------------------------------------------------------------------------ */
alter table public.legends enable row level security;

drop policy if exists "Approved members can read active legends" on public.legends;
create policy "Approved members can read active legends"
  on public.legends for select to authenticated
  using (
    (active and (public.is_approved() or public.is_admin()))
    or public.is_admin()
  );

drop policy if exists "Admins can insert legends" on public.legends;
create policy "Admins can insert legends"
  on public.legends for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update legends" on public.legends;
create policy "Admins can update legends"
  on public.legends for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete legends" on public.legends;
create policy "Admins can delete legends"
  on public.legends for delete to authenticated
  using (public.is_admin());


/* ---------------------------------------------------------------------------
   updated_at

   Set by a trigger rather than by the client, so it can't be forgotten in one
   of the two places Admin.jsx writes to this table (create and edit).
   ------------------------------------------------------------------------ */
create or replace function public.touch_legends_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists legends_touch_updated_at on public.legends;
create trigger legends_touch_updated_at
  before update on public.legends
  for each row execute function public.touch_legends_updated_at();


/* ---------------------------------------------------------------------------
   Storage: legend portraits

   Public bucket, because these are photos rendered directly into <img> tags
   on the home page — the same shape as business-logos and post-images. Unlike
   those, it ships with a size and mime limit from day one (the security audit
   flagged the older buckets for having neither; no reason to add a tenth).

   Uploads are admin-only, matching the table. Nothing here is user-owned, so
   there is no `(storage.foldername(name))[1] = auth.uid()` scoping — admins
   need to be able to replace each other's uploads.
   ------------------------------------------------------------------------ */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'legend-photos', 'legend-photos', true,
  5242880, -- 5 MB, matches MAX_PHOTO_SIZE in Admin.jsx
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can read legend photos" on storage.objects;
create policy "Anyone can read legend photos"
  on storage.objects for select
  using (bucket_id = 'legend-photos');

drop policy if exists "Admins can upload legend photos" on storage.objects;
create policy "Admins can upload legend photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'legend-photos' and public.is_admin());

drop policy if exists "Admins can update legend photos" on storage.objects;
create policy "Admins can update legend photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'legend-photos' and public.is_admin());

drop policy if exists "Admins can delete legend photos" on storage.objects;
create policy "Admins can delete legend photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'legend-photos' and public.is_admin());


-- ============================================================
-- Migration 56  (schema-update-56.sql)
-- ============================================================
-- schema-update-56.sql — Mentoring rebuild
--
-- The July rip-out (migrations 20260715/20260722) left mentoring as a single
-- profile toggle and a browse-only page: you could see who was willing, and
-- that was the whole feature. Nothing recorded that a mentorship had actually
-- started, so nobody could tell a real pairing from a name on a list.
--
-- This rebuilds it around three ideas, deliberately keeping the low-friction
-- path intact:
--
--   * Flash mentoring stays. Messaging someone a quick question needs no
--     row in any table, and that remains the default action on a mentor card.
--   * Structured mentorships are opt-in on top: request -> accept -> active,
--     with goals and a session log, and an explicit ending. Both sides can
--     initiate, because a mentor spotting a promising mentee is just as
--     valuable as the reverse.
--   * Mentees become visible. Previously only mentors existed as a concept,
--     so a willing mentor had nobody to look for.
--
-- Every state change goes through a SECURITY DEFINER function rather than an
-- UPDATE policy. Status transitions here have real rules (only the recipient
-- may accept, only the initiator may cancel, accepting must respect capacity)
-- and those are painful to express as a WITH CHECK expression and easy to get
-- subtly wrong. mentorships therefore has a SELECT policy and nothing else.

-- ============================================================
-- 1. Profile columns
-- ============================================================

-- The mentee side. is_open_to_opportunities already means "I'll mentor";
-- there was no way to say "I'm looking for one", which is why Find a Mentee
-- couldn't exist.
alter table public.profiles
  add column if not exists seeking_mentor boolean not null default false,
  add column if not exists mentee_goals text[] not null default '{}',
  add column if not exists mentee_note text not null default '',
  -- Capacity is per-mentor rather than a global constant: an alumnus with
  -- one evening a month and one with a standing Friday slot are not the same
  -- offer, and the old page presented them identically.
  add column if not exists mentor_capacity smallint not null default 2,
  -- Snooze, not opt-out. Someone who is temporarily swamped should be able to
  -- stop new requests without deleting their expertise, availability and
  -- everything else they filled in — otherwise the only way to get a quiet
  -- month is to wipe the profile section and rebuild it later.
  add column if not exists mentor_paused boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_mentor_capacity_range'
  ) then
    alter table public.profiles
      add constraint profiles_mentor_capacity_range
      check (mentor_capacity between 1 and 20);
  end if;
end $$;

-- ============================================================
-- 2. mentorships
-- ============================================================

create table if not exists public.mentorships (
  id bigint generated always as identity primary key,
  mentor_id uuid not null references public.profiles(id) on delete cascade,
  mentee_id uuid not null references public.profiles(id) on delete cascade,
  -- Which side asked. Needed for wording ("X asked you to mentor them" vs
  -- "X offered to mentor you") and to decide who is allowed to cancel.
  initiated_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'declined', 'cancelled', 'completed', 'ended')),
  request_message text not null default '',
  response_message text not null default '',
  -- What this pairing is actually about. Copied from the requester's goals at
  -- request time rather than read live off the profile, so a mentorship keeps
  -- the focus it was agreed on even after the mentee's profile moves on.
  focus text[] not null default '{}',
  cadence text not null default '',
  duration_months smallint,
  closing_note text not null default '',
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint mentorships_distinct_parties check (mentor_id <> mentee_id),
  constraint mentorships_initiator_is_party
    check (initiated_by in (mentor_id, mentee_id)),
  constraint mentorships_duration_range
    check (duration_months is null or duration_months between 1 and 36)
);

-- One live pairing per pair of people. Without this, an impatient mentee could
-- fire off the same request repeatedly and the mentor would see five identical
-- cards. Finished mentorships are excluded so the same two people can go
-- around again later.
create unique index if not exists mentorships_one_live_pair
  on public.mentorships (mentor_id, mentee_id)
  where status in ('pending', 'active');

create index if not exists mentorships_mentor_idx on public.mentorships (mentor_id, status);
create index if not exists mentorships_mentee_idx on public.mentorships (mentee_id, status);

create or replace function public.touch_mentorship_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mentorships_touch_updated_at on public.mentorships;
create trigger mentorships_touch_updated_at
  before update on public.mentorships
  for each row execute function public.touch_mentorship_updated_at();

alter table public.mentorships enable row level security;

-- Read-only for the two people involved (admins get the same view for
-- moderation). No INSERT/UPDATE/DELETE policies at all — see the header note.
drop policy if exists "Parties can view their mentorships" on public.mentorships;
create policy "Parties can view their mentorships" on public.mentorships
  for select using (
    mentor_id = (select auth.uid())
    or mentee_id = (select auth.uid())
    or (select public.is_admin())
  );

-- ============================================================
-- 3. Goals and sessions
-- ============================================================

create table if not exists public.mentorship_goals (
  id bigint generated always as identity primary key,
  mentorship_id bigint not null references public.mentorships(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  detail text not null default '',
  status text not null default 'open' check (status in ('open', 'done')),
  target_date date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists mentorship_goals_mentorship_idx
  on public.mentorship_goals (mentorship_id);

create table if not exists public.mentorship_sessions (
  id bigint generated always as identity primary key,
  mentorship_id bigint not null references public.mentorships(id) on delete cascade,
  logged_by uuid references public.profiles(id) on delete set null,
  met_on date not null default (now() at time zone 'Africa/Johannesburg')::date,
  duration_minutes smallint check (duration_minutes is null or duration_minutes between 5 and 600),
  notes text not null default '',
  -- The single most useful thing to capture after a conversation, and the
  -- thing most likely to be forgotten by the next one.
  next_steps text not null default '',
  next_session_on date,
  created_at timestamptz not null default now()
);

create index if not exists mentorship_sessions_mentorship_idx
  on public.mentorship_sessions (mentorship_id, met_on desc);

-- Membership test used by every policy below. SECURITY DEFINER so the policy
-- can look at mentorships without recursing back through its own RLS.
create or replace function public.is_mentorship_member(p_mentorship_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.mentorships m
    where m.id = p_mentorship_id
      and (select auth.uid()) in (m.mentor_id, m.mentee_id)
  );
$$;

create or replace function public.is_active_mentorship_member(p_mentorship_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.mentorships m
    where m.id = p_mentorship_id
      and m.status = 'active'
      and (select auth.uid()) in (m.mentor_id, m.mentee_id)
  );
$$;

alter table public.mentorship_goals enable row level security;
alter table public.mentorship_sessions enable row level security;

-- Reading is allowed for any status so a completed mentorship keeps its
-- history; writing is limited to active ones, so nobody edits the record of a
-- pairing that has already been wrapped up.
drop policy if exists "Members can read goals" on public.mentorship_goals;
create policy "Members can read goals" on public.mentorship_goals
  for select using ((select public.is_mentorship_member(mentorship_id)));

drop policy if exists "Members can add goals" on public.mentorship_goals;
create policy "Members can add goals" on public.mentorship_goals
  for insert with check (
    created_by = (select auth.uid())
    and (select public.is_active_mentorship_member(mentorship_id))
  );

drop policy if exists "Members can update goals" on public.mentorship_goals;
create policy "Members can update goals" on public.mentorship_goals
  for update
  using ((select public.is_active_mentorship_member(mentorship_id)))
  with check ((select public.is_active_mentorship_member(mentorship_id)));

drop policy if exists "Members can delete goals" on public.mentorship_goals;
create policy "Members can delete goals" on public.mentorship_goals
  for delete using ((select public.is_active_mentorship_member(mentorship_id)));

drop policy if exists "Members can read sessions" on public.mentorship_sessions;
create policy "Members can read sessions" on public.mentorship_sessions
  for select using ((select public.is_mentorship_member(mentorship_id)));

drop policy if exists "Members can log sessions" on public.mentorship_sessions;
create policy "Members can log sessions" on public.mentorship_sessions
  for insert with check (
    logged_by = (select auth.uid())
    and (select public.is_active_mentorship_member(mentorship_id))
  );

-- Only the person who wrote a session note may change or remove it — these
-- are personal notes on a conversation, not a shared document.
drop policy if exists "Authors can edit their sessions" on public.mentorship_sessions;
create policy "Authors can edit their sessions" on public.mentorship_sessions
  for update
  using (logged_by = (select auth.uid()) and (select public.is_active_mentorship_member(mentorship_id)))
  with check (logged_by = (select auth.uid()));

drop policy if exists "Authors can delete their sessions" on public.mentorship_sessions;
create policy "Authors can delete their sessions" on public.mentorship_sessions
  for delete using (logged_by = (select auth.uid()));

-- ============================================================
-- 4. State transitions
-- ============================================================

create or replace function public.mentor_active_count(p_mentor uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int from public.mentorships
  where mentor_id = p_mentor and status = 'active';
$$;

-- Requesting. `p_as_mentor` says which chair the caller is sitting in:
-- true  = "I'd like to mentor you"  (caller is the mentor)
-- false = "Would you mentor me?"    (caller is the mentee)
create or replace function public.request_mentorship(
  p_other uuid,
  p_as_mentor boolean,
  p_message text default '',
  p_focus text[] default '{}',
  p_cadence text default '',
  p_duration smallint default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_mentor uuid;
  v_mentee uuid;
  v_other public.profiles%rowtype;
  v_me_row public.profiles%rowtype;
  v_pending int;
  v_id bigint;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_other is null or p_other = v_me then
    raise exception 'You cannot start a mentorship with yourself' using errcode = '22023';
  end if;

  select * into v_me_row from public.profiles where id = v_me;
  select * into v_other from public.profiles where id = p_other;

  if v_other.id is null or not v_other.approved then
    raise exception 'That member is not available' using errcode = '22023';
  end if;
  if not coalesce(v_me_row.approved, false) then
    raise exception 'Your account must be approved first' using errcode = '42501';
  end if;

  if p_as_mentor then
    v_mentor := v_me;
    v_mentee := p_other;
    -- Offering to mentor requires that you have said you are open to it, and
    -- that they have said they are looking. Unsolicited offers land as
    -- messages instead, which is what flash mentoring is for.
    if not coalesce(v_me_row.is_open_to_opportunities, false) then
      raise exception 'Turn on "open to mentoring" on your profile first' using errcode = '42501';
    end if;
    if not coalesce(v_other.seeking_mentor, false) then
      raise exception 'That member is not looking for a mentor right now' using errcode = '22023';
    end if;
  else
    v_mentor := p_other;
    v_mentee := v_me;
    if not coalesce(v_other.is_open_to_opportunities, false) then
      raise exception 'That member is not open to mentoring right now' using errcode = '22023';
    end if;
    if coalesce(v_other.mentor_paused, false) then
      raise exception 'That mentor has paused new requests' using errcode = '22023';
    end if;
  end if;

  -- Either direction counts: if they already asked you, answer that request
  -- rather than creating a mirror-image one.
  if exists (
    select 1 from public.mentorships
    where status in ('pending', 'active')
      and ((mentor_id = v_mentor and mentee_id = v_mentee)
        or (mentor_id = v_mentee and mentee_id = v_mentor))
  ) then
    raise exception 'You already have a request or mentorship with this member' using errcode = '23505';
  end if;

  -- Light rate limit. Not a security control so much as a nudge away from
  -- spraying the whole directory, which is the fastest way to make mentors
  -- switch the toggle off.
  select count(*) into v_pending from public.mentorships
  where initiated_by = v_me and status = 'pending';
  if v_pending >= 10 then
    raise exception 'You have too many requests waiting for an answer' using errcode = '54000';
  end if;

  insert into public.mentorships (
    mentor_id, mentee_id, initiated_by, request_message, focus, cadence, duration_months
  ) values (
    v_mentor, v_mentee, v_me,
    left(coalesce(p_message, ''), 1000),
    coalesce(p_focus, '{}'::text[]),
    left(coalesce(p_cadence, ''), 60),
    p_duration
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Answering. Only the person who did not send it may accept or decline.
create or replace function public.respond_to_mentorship(
  p_id bigint,
  p_accept boolean,
  p_message text default ''
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  m public.mentorships%rowtype;
  v_capacity smallint;
  v_active int;
begin
  select * into m from public.mentorships where id = p_id;
  if m.id is null then
    raise exception 'Request not found' using errcode = '22023';
  end if;
  if v_me not in (m.mentor_id, m.mentee_id) then
    raise exception 'Not your request' using errcode = '42501';
  end if;
  if v_me = m.initiated_by then
    raise exception 'You sent this request — cancel it instead' using errcode = '42501';
  end if;
  if m.status <> 'pending' then
    raise exception 'This request has already been answered' using errcode = '22023';
  end if;

  if p_accept then
    -- Capacity is checked here rather than at request time on purpose: a
    -- full mentor should still be able to see who is interested and choose,
    -- they just cannot say yes to everyone at once.
    select mentor_capacity into v_capacity from public.profiles where id = m.mentor_id;
    v_active := public.mentor_active_count(m.mentor_id);
    if v_active >= coalesce(v_capacity, 2) then
      raise exception 'AT_CAPACITY' using errcode = '54000';
    end if;

    update public.mentorships
      set status = 'active',
          responded_at = now(),
          started_at = now(),
          response_message = left(coalesce(p_message, ''), 1000)
      where id = p_id;
  else
    update public.mentorships
      set status = 'declined',
          responded_at = now(),
          response_message = left(coalesce(p_message, ''), 1000)
      where id = p_id;
  end if;
end;
$$;

-- Withdrawing a request you sent, before it has been answered.
create or replace function public.cancel_mentorship_request(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  m public.mentorships%rowtype;
begin
  select * into m from public.mentorships where id = p_id;
  if m.id is null then
    raise exception 'Request not found' using errcode = '22023';
  end if;
  if m.initiated_by <> v_me then
    raise exception 'Only the sender can withdraw a request' using errcode = '42501';
  end if;
  if m.status <> 'pending' then
    raise exception 'This request has already been answered' using errcode = '22023';
  end if;

  update public.mentorships
    set status = 'cancelled', responded_at = now()
    where id = p_id;
end;
$$;

-- Ending an active mentorship. `p_completed` distinguishes "we got there"
-- from "this fizzled out" — worth separating, because a mentor with three
-- completed mentorships and one with three abandoned ones are telling very
-- different stories, and lumping them together would flatter the second.
create or replace function public.end_mentorship(
  p_id bigint,
  p_completed boolean default true,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  m public.mentorships%rowtype;
begin
  select * into m from public.mentorships where id = p_id;
  if m.id is null then
    raise exception 'Mentorship not found' using errcode = '22023';
  end if;
  if v_me not in (m.mentor_id, m.mentee_id) then
    raise exception 'Not your mentorship' using errcode = '42501';
  end if;
  if m.status <> 'active' then
    raise exception 'This mentorship is not active' using errcode = '22023';
  end if;

  update public.mentorships
    set status = case when p_completed then 'completed' else 'ended' end,
        ended_at = now(),
        ended_by = v_me,
        closing_note = left(coalesce(p_note, ''), 1000)
    where id = p_id;
end;
$$;

-- ============================================================
-- 5. Notifications
-- ============================================================
--
-- Written by triggers, matching every other notification in this app.
-- notifications has no INSERT policy for `authenticated`, so a client-side
-- insert would be silently rejected by RLS — the exact bug that left job
-- posters unaware of applications until schema-update-47.

create or replace function public.notify_mentorship_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target uuid;
  v_actor_name text;
begin
  v_target := case when new.initiated_by = new.mentor_id then new.mentee_id else new.mentor_id end;
  select full_name into v_actor_name from public.profiles where id = new.initiated_by;

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (
    v_target, new.initiated_by, 'mentorship_request', 'mentorship', new.id,
    coalesce(v_actor_name, 'Someone') ||
    case when new.initiated_by = new.mentor_id
      then ' offered to mentor you.'
      else ' asked you to be their mentor.'
    end
  );
  return new;
exception when others then
  raise warning 'notify_mentorship_request failed for % — %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists mentorships_notify_request on public.mentorships;
create trigger mentorships_notify_request
  after insert on public.mentorships
  for each row execute function public.notify_mentorship_request();

create or replace function public.notify_mentorship_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid;
  v_target uuid;
  v_actor_name text;
  v_message text;
begin
  if new.status = old.status then return new; end if;

  if new.status in ('active', 'declined') then
    -- The responder is whoever did not send it.
    v_actor := case when new.initiated_by = new.mentor_id then new.mentee_id else new.mentor_id end;
    v_target := new.initiated_by;
    select full_name into v_actor_name from public.profiles where id = v_actor;
    v_message := coalesce(v_actor_name, 'Someone') ||
      case when new.status = 'active'
        then ' accepted your mentorship request.'
        else ' declined your mentorship request.'
      end;
  elsif new.status in ('completed', 'ended') then
    v_actor := new.ended_by;
    v_target := case when v_actor = new.mentor_id then new.mentee_id else new.mentor_id end;
    select full_name into v_actor_name from public.profiles where id = v_actor;
    v_message := coalesce(v_actor_name, 'Someone') ||
      case when new.status = 'completed'
        then ' marked your mentorship as complete.'
        else ' ended your mentorship.'
      end;
  else
    -- 'cancelled' deliberately notifies nobody: a withdrawn request that was
    -- never answered is best left as if it had not happened.
    return new;
  end if;

  if v_target is null or v_actor is null or v_target = v_actor then return new; end if;

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_target, v_actor, 'mentorship_' || new.status, 'mentorship', new.id, v_message);
  return new;
exception when others then
  raise warning 'notify_mentorship_status failed for % — %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists mentorships_notify_status on public.mentorships;
create trigger mentorships_notify_status
  after update of status on public.mentorships
  for each row execute function public.notify_mentorship_status();

create or replace function public.notify_mentorship_session()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m public.mentorships%rowtype;
  v_target uuid;
  v_actor_name text;
begin
  select * into m from public.mentorships where id = new.mentorship_id;
  if m.id is null then return new; end if;

  v_target := case when new.logged_by = m.mentor_id then m.mentee_id else m.mentor_id end;
  if v_target is null or v_target = new.logged_by then return new; end if;

  select full_name into v_actor_name from public.profiles where id = new.logged_by;

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (
    v_target, new.logged_by, 'mentorship_session', 'mentorship', m.id,
    coalesce(v_actor_name, 'Someone') || ' logged a mentoring session.'
  );
  return new;
exception when others then
  raise warning 'notify_mentorship_session failed for % — %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists mentorship_sessions_notify on public.mentorship_sessions;
create trigger mentorship_sessions_notify
  after insert on public.mentorship_sessions
  for each row execute function public.notify_mentorship_session();

-- ============================================================
-- 6. How full each mentor is
-- ============================================================
--
-- The mentorships SELECT policy only shows you your own pairings, which is
-- right, but it means the browse page cannot tell whether a mentor already
-- has three people on the go. Fetching that per card would be one round trip
-- per mentor; this returns the whole picture at once and exposes only a
-- count, never who the other party is.

create or replace function public.mentor_load()
returns table (mentor_id uuid, active_count integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.mentor_id, count(*)::int
  from public.mentorships m
  where m.status = 'active'
    and (select public.is_approved())
  group by m.mentor_id;
$$;

-- ============================================================
-- 7. Grants
-- ============================================================
--
-- Revoked from `public`, not from `anon`. Revoking from a specific role that
-- never held the grant directly is a no-op — the privilege comes from PUBLIC
-- (see schema-update-49 and the admin activity log migration, which learned
-- this the hard way).

revoke all on function public.request_mentorship(uuid, boolean, text, text[], text, smallint) from public;
revoke all on function public.respond_to_mentorship(bigint, boolean, text) from public;
revoke all on function public.cancel_mentorship_request(bigint) from public;
revoke all on function public.end_mentorship(bigint, boolean, text) from public;
revoke all on function public.mentor_active_count(uuid) from public;
revoke all on function public.is_mentorship_member(bigint) from public;
revoke all on function public.is_active_mentorship_member(bigint) from public;
revoke all on function public.mentor_load() from public;

grant execute on function public.mentor_load() to authenticated;
grant execute on function public.request_mentorship(uuid, boolean, text, text[], text, smallint) to authenticated;
grant execute on function public.respond_to_mentorship(bigint, boolean, text) to authenticated;
grant execute on function public.cancel_mentorship_request(bigint) to authenticated;
grant execute on function public.end_mentorship(bigint, boolean, text) to authenticated;
grant execute on function public.mentor_active_count(uuid) to authenticated;
grant execute on function public.is_mentorship_member(bigint) to authenticated;
grant execute on function public.is_active_mentorship_member(bigint) to authenticated;

grant select on public.mentorships to authenticated;
grant select, insert, update, delete on public.mentorship_goals to authenticated;
grant select, insert, update, delete on public.mentorship_sessions to authenticated;


-- ============================================================
-- Migration 57  (schema-update-57.sql)
-- ============================================================
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
   verifying a signup against Eendrag residence records needs the legal
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
   Someone who isn't an Eendragter therefore sat on the "we're verifying
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

