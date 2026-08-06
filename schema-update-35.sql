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
