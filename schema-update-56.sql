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
