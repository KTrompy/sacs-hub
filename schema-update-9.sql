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
