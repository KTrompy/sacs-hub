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
