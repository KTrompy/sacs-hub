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
