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
