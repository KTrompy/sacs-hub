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
