-- ============================================================
-- Update 64: Mentoring Programme — ground-up redesign (backend)
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Context:
--   The mentoring frontend is being rebuilt from a blank page around three
--   jobs — find someone useful, start the right kind of interaction, keep it
--   moving — instead of the old Find-a-mentor/Find-a-mentee/My-mentoring/
--   Settings tab set. This migration extends the backend to support that:
--
--   * A genuine low-commitment tier (mentorship_connections) for a single
--     question or a one-off conversation, sitting below the existing
--     request -> accept -> active mentorship. Previously the only options
--     were a one-shot email (schema-update-63) or a full mentorship request
--     — nothing tracked, nothing in between.
--   * A negotiation step ('discussing') so a mentor can propose different
--     terms instead of only accept/decline.
--   * Explicit next actions, lightweight check-ins, and a richer, human
--     ending (three reasons, not just completed/ended) on top of the
--     existing goals/sessions.
--   * Saved people, and a small set of per-member mentoring preferences
--     that drive matching without adding more raw settings to Profile.jsx.
--
--   `profiles.is_open_to_opportunities` / `seeking_mentor` / `mentor_capacity`
--   / `mentor_paused` / `expertise` / `mentee_goals` / `mentee_note` all stay
--   exactly as they are — Directory's "Mentors" filter, Profile.jsx's
--   Mentoring section and PersonProfile's Ask/Offer buttons all keep working
--   unchanged. `mentoring_profiles` adds the finer-grained switches (quick
--   questions / conversations / ongoing, matching preferences, the guidance
--   goal) the new product needs on top, one row per member, created lazily.
--
--   Safe to run on a database with no real mentoring history yet (this
--   project is pre-launch — every mentoring table currently has zero rows).
--   If this is ever run against a database with live mentorships, note that
--   the `mentorships_one_live_pair` index and `respond_to_mentorship` /
--   `cancel_mentorship_request` are replaced with widened versions below.
-- ============================================================

-- ============================================================
-- 1. mentoring_profiles — per-member mentoring preferences
-- ============================================================
create table if not exists public.mentoring_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  quick_questions_enabled boolean not null default true,
  conversations_enabled boolean not null default true,
  mentorships_enabled boolean not null default true,
  mentor_paused_until timestamptz,
  guidance_goal text not null default '',
  pref_experience boolean not null default true,
  pref_international boolean not null default false,
  pref_local boolean not null default false,
  pref_same_industry boolean not null default false,
  pref_seniority boolean not null default false,
  onboarding_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_mentoring_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mentoring_profiles_touch_updated_at on public.mentoring_profiles;
create trigger mentoring_profiles_touch_updated_at
  before update on public.mentoring_profiles
  for each row execute function public.touch_mentoring_profile_updated_at();

alter table public.mentoring_profiles enable row level security;

-- Preferences carry no business rule that needs a SECURITY DEFINER gate —
-- unlike mentorships, saying "I don't mind distance" can't be abused, so a
-- plain owner-only policy is enough (same reasoning as saved_jobs/saved_events).
drop policy if exists "Anyone can read mentoring profiles" on public.mentoring_profiles;
create policy "Anyone can read mentoring profiles" on public.mentoring_profiles
  for select using ((select public.is_approved()) or (select public.is_admin()));

drop policy if exists "Members manage their own mentoring profile" on public.mentoring_profiles;
create policy "Members manage their own mentoring profile" on public.mentoring_profiles
  for insert with check (profile_id = (select auth.uid()));

drop policy if exists "Members update their own mentoring profile" on public.mentoring_profiles;
create policy "Members update their own mentoring profile" on public.mentoring_profiles
  for update using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

-- ============================================================
-- 2. mentorships — extend the existing table for the new lifecycle
-- ============================================================
alter table public.mentorships
  add column if not exists expected_length text not null default ''
    check (expected_length in ('few_months', 'six_months', 'longer_term', 'decide_together', '')),
  add column if not exists review_at timestamptz,
  add column if not exists last_interaction_at timestamptz,
  add column if not exists next_interaction_at timestamptz,
  add column if not exists next_action text not null default '',
  add column if not exists next_action_owner text not null default ''
    check (next_action_owner in ('mentor', 'mentee', 'both', '')),
  add column if not exists outcome text
    check (outcome is null or outcome in ('achieved', 'natural_stop', 'not_right_fit')),
  add column if not exists reflection text not null default '',
  add column if not exists decline_reason text not null default '';

-- Widen the status set to include 'discussing' — a mentor proposing
-- different terms instead of a flat accept/decline (rule 76.6: don't force
-- a binary choice on someone who might say yes to something slightly
-- different).
alter table public.mentorships drop constraint if exists mentorships_status_check;
alter table public.mentorships add constraint mentorships_status_check
  check (status in ('pending', 'discussing', 'active', 'declined', 'cancelled', 'completed', 'ended'));

-- A live negotiation still blocks a duplicate request from either side.
drop index if exists public.mentorships_one_live_pair;
create unique index if not exists mentorships_one_live_pair
  on public.mentorships (mentor_id, mentee_id)
  where status in ('pending', 'discussing', 'active');

-- ============================================================
-- 3. mentorship_terms — the counter-proposal behind "Suggest changes"
-- ============================================================
create table if not exists public.mentorship_terms (
  id bigint generated always as identity primary key,
  mentorship_id bigint not null references public.mentorships(id) on delete cascade,
  proposed_by uuid not null references public.profiles(id) on delete cascade,
  cadence text not null default '',
  expected_length text not null default ''
    check (expected_length in ('few_months', 'six_months', 'longer_term', 'decide_together', '')),
  focus text[] not null default '{}',
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists mentorship_terms_mentorship_idx
  on public.mentorship_terms (mentorship_id, created_at desc);

alter table public.mentorship_terms enable row level security;

drop policy if exists "Members can read proposed terms" on public.mentorship_terms;
create policy "Members can read proposed terms" on public.mentorship_terms
  for select using ((select public.is_mentorship_member(mentorship_id)));

-- No insert/update/delete policy — written only by respond_to_mentorship()
-- below, which is SECURITY DEFINER and validates who may propose what.

-- ============================================================
-- 4. mentorship_sessions — richer next-step tracking
-- ============================================================
alter table public.mentorship_sessions
  add column if not exists next_conversation_at timestamptz,
  add column if not exists next_step_owner text not null default ''
    check (next_step_owner in ('mentor', 'mentee', 'both', ''));

-- Every logged session updates the parent mentorship's "what's happening
-- now" fields, so the workspace never has to recompute them from the whole
-- session history on every load.
create or replace function public.touch_mentorship_after_session()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.mentorships
    set last_interaction_at = greatest(coalesce(last_interaction_at, 'epoch'::timestamptz),
          (new.met_on::timestamptz)),
        next_interaction_at = new.next_conversation_at,
        next_action = coalesce(new.next_steps, ''),
        next_action_owner = case when new.next_steps <> '' then coalesce(nullif(new.next_step_owner, ''), 'mentee') else '' end
    where id = new.mentorship_id;
  return new;
exception when others then
  raise warning 'touch_mentorship_after_session failed for % — %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists mentorship_sessions_touch_parent on public.mentorship_sessions;
create trigger mentorship_sessions_touch_parent
  after insert on public.mentorship_sessions
  for each row execute function public.touch_mentorship_after_session();

-- ============================================================
-- 5. mentorship_goals — ownership
-- ============================================================
alter table public.mentorship_goals
  add column if not exists owner text not null default 'mentee'
    check (owner in ('mentor', 'mentee', 'both'));

-- ============================================================
-- 6. mentorship_actions — explicit next actions (separate from goals)
-- ============================================================
create table if not exists public.mentorship_actions (
  id bigint generated always as identity primary key,
  mentorship_id bigint not null references public.mentorships(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  owner text not null default 'mentee' check (owner in ('mentor', 'mentee', 'both')),
  due_date date,
  completed_at timestamptz,
  created_from_session bigint references public.mentorship_sessions(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists mentorship_actions_mentorship_idx
  on public.mentorship_actions (mentorship_id);

alter table public.mentorship_actions enable row level security;

drop policy if exists "Members can read actions" on public.mentorship_actions;
create policy "Members can read actions" on public.mentorship_actions
  for select using ((select public.is_mentorship_member(mentorship_id)));

drop policy if exists "Members can add actions" on public.mentorship_actions;
create policy "Members can add actions" on public.mentorship_actions
  for insert with check (
    created_by = (select auth.uid())
    and (select public.is_active_mentorship_member(mentorship_id))
  );

drop policy if exists "Members can update actions" on public.mentorship_actions;
create policy "Members can update actions" on public.mentorship_actions
  for update
  using ((select public.is_active_mentorship_member(mentorship_id)))
  with check ((select public.is_active_mentorship_member(mentorship_id)));

drop policy if exists "Members can delete actions" on public.mentorship_actions;
create policy "Members can delete actions" on public.mentorship_actions
  for delete using ((select public.is_active_mentorship_member(mentorship_id)));

-- ============================================================
-- 7. mentorship_checkins — periodic, private "is this still useful"
-- ============================================================
create table if not exists public.mentorship_checkins (
  id bigint generated always as identity primary key,
  mentorship_id bigint not null references public.mentorships(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  response text not null check (response in ('very_useful', 'useful', 'needs_adjustment', 'ready_to_wrap')),
  created_at timestamptz not null default now()
);

create index if not exists mentorship_checkins_mentorship_idx
  on public.mentorship_checkins (mentorship_id);

alter table public.mentorship_checkins enable row level security;

-- Answers stay private from the other party (rule in the spec: don't expose
-- private check-in answers directly) — only the person who answered, or an
-- admin looking at programme-wide health, can read a row.
drop policy if exists "Members read their own checkins" on public.mentorship_checkins;
create policy "Members read their own checkins" on public.mentorship_checkins
  for select using (profile_id = (select auth.uid()) or (select public.is_admin()));

-- No insert policy — written only by submit_mentorship_checkin() below.

-- ============================================================
-- 8. saved_mentors — save someone for later
-- ============================================================
create table if not exists public.saved_mentors (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  saved_profile_id uuid not null references public.profiles(id) on delete cascade,
  notify_when_available boolean not null default false,
  created_at timestamptz not null default now(),
  constraint saved_mentors_distinct check (profile_id <> saved_profile_id),
  constraint saved_mentors_unique unique (profile_id, saved_profile_id)
);

create index if not exists saved_mentors_profile_idx on public.saved_mentors (profile_id);

alter table public.saved_mentors enable row level security;

drop policy if exists "Members manage their own saved mentors" on public.saved_mentors;
create policy "Members manage their own saved mentors" on public.saved_mentors
  for all using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

-- ============================================================
-- 9. mentorship_connections — quick questions & one-off conversations
-- ============================================================
--
-- The commitment ladder below a full mentorship. schema-update-63 removed
-- the in-app DM thread, so this is now the only place a "quick question" or
-- a one-off conversation leaves a trace either person can come back to —
-- it is deliberately self-contained rather than routed through email.
create table if not exists public.mentorship_connections (
  id bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('question', 'conversation')),
  message text not null default '',
  duration_minutes smallint check (duration_minutes is null or duration_minutes in (20, 30, 45)),
  status text not null default 'sent'
    check (status in ('sent', 'answered', 'scheduled', 'declined', 'withdrawn', 'expired')),
  reply text not null default '',
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  constraint mentorship_connections_distinct check (requester_id <> recipient_id)
);

create index if not exists mentorship_connections_recipient_idx
  on public.mentorship_connections (recipient_id, status);
create index if not exists mentorship_connections_requester_idx
  on public.mentorship_connections (requester_id, status);

alter table public.mentorship_connections enable row level security;

drop policy if exists "Parties can view their connections" on public.mentorship_connections;
create policy "Parties can view their connections" on public.mentorship_connections
  for select using (
    requester_id = (select auth.uid())
    or recipient_id = (select auth.uid())
    or (select public.is_admin())
  );

-- No insert/update policy — see send_mentoring_connection() and
-- respond_mentoring_connection() below, same reasoning as mentorships.

-- ============================================================
-- 10. State transitions — mentorship_connections
-- ============================================================
create or replace function public.send_mentoring_connection(
  p_recipient uuid,
  p_kind text,
  p_message text default '',
  p_duration smallint default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_other public.profiles%rowtype;
  v_me_row public.profiles%rowtype;
  v_enabled boolean;
  v_open_count int;
  v_id bigint;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_recipient is null or p_recipient = v_me then
    raise exception 'You cannot do this with yourself' using errcode = '22023';
  end if;
  if p_kind not in ('question', 'conversation') then
    raise exception 'Unknown connection kind' using errcode = '22023';
  end if;
  if btrim(coalesce(p_message, '')) = '' then
    raise exception 'Add a message' using errcode = '22023';
  end if;

  select * into v_me_row from public.profiles where id = v_me;
  select * into v_other from public.profiles where id = p_recipient;

  if v_other.id is null or not v_other.approved then
    raise exception 'That member is not available' using errcode = '22023';
  end if;
  if not coalesce(v_me_row.approved, false) then
    raise exception 'Your account must be approved first' using errcode = '42501';
  end if;

  -- Missing mentoring_profiles row means default settings (both on), same
  -- as a member who has never opened Mentoring but is still reachable.
  select case when p_kind = 'question' then coalesce(mp.quick_questions_enabled, true)
              else coalesce(mp.conversations_enabled, true) end
    into v_enabled
    from (select 1) x
    left join public.mentoring_profiles mp on mp.profile_id = p_recipient;

  if not v_enabled then
    raise exception 'NOT_AVAILABLE' using errcode = '22023';
  end if;

  -- Soft spam protection (rule 49): guide rather than hard-block, but stop a
  -- directory-wide spray of asks.
  select count(*) into v_open_count from public.mentorship_connections
    where requester_id = v_me and status = 'sent';
  if v_open_count >= 15 then
    raise exception 'TOO_MANY_OPEN' using errcode = '54000';
  end if;

  insert into public.mentorship_connections (requester_id, recipient_id, kind, message, duration_minutes)
  values (v_me, p_recipient, p_kind, left(btrim(p_message), 2000), p_duration)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.respond_mentoring_connection(
  p_id bigint,
  p_action text,
  p_reply text default '',
  p_scheduled_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  c public.mentorship_connections%rowtype;
begin
  select * into c from public.mentorship_connections where id = p_id;
  if c.id is null then
    raise exception 'Not found' using errcode = '22023';
  end if;
  if c.status <> 'sent' then
    raise exception 'This has already been answered' using errcode = '22023';
  end if;

  if p_action in ('answer', 'schedule', 'decline') then
    if v_me <> c.recipient_id then
      raise exception 'Not yours to answer' using errcode = '42501';
    end if;
    update public.mentorship_connections
      set status = case p_action when 'answer' then 'answered'
                                  when 'schedule' then 'scheduled'
                                  else 'declined' end,
          reply = left(coalesce(p_reply, ''), 2000),
          scheduled_at = case when p_action = 'schedule' then p_scheduled_at else null end,
          responded_at = now()
      where id = p_id;
  elsif p_action = 'withdraw' then
    if v_me <> c.requester_id then
      raise exception 'Not yours to withdraw' using errcode = '42501';
    end if;
    update public.mentorship_connections
      set status = 'withdrawn', responded_at = now()
      where id = p_id;
  else
    raise exception 'Unknown action' using errcode = '22023';
  end if;
end;
$$;

-- ============================================================
-- 11. State transitions — mentorships (extended request/respond)
-- ============================================================
-- Both signatures below add/reshape parameters rather than purely appending
-- optional ones, so CREATE OR REPLACE would leave the old overload sitting
-- alongside the new one instead of replacing it — dropped explicitly first.
drop function if exists public.request_mentorship(uuid, boolean, text, text[], text, smallint);
drop function if exists public.respond_to_mentorship(bigint, boolean, text);

create or replace function public.request_mentorship(
  p_other uuid,
  p_as_mentor boolean,
  p_message text default '',
  p_focus text[] default '{}',
  p_cadence text default '',
  p_duration smallint default null,
  p_expected_length text default ''
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
  if p_expected_length not in ('few_months', 'six_months', 'longer_term', 'decide_together', '') then
    raise exception 'Unknown expected length' using errcode = '22023';
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
    if not coalesce(v_me_row.is_open_to_opportunities, false) then
      raise exception 'Turn on "I can help others" on your mentoring profile first' using errcode = '42501';
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
      raise exception 'That mentor has paused new mentorships' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from public.mentorships
    where status in ('pending', 'discussing', 'active')
      and ((mentor_id = v_mentor and mentee_id = v_mentee)
        or (mentor_id = v_mentee and mentee_id = v_mentor))
  ) then
    raise exception 'You already have a request or mentorship with this member' using errcode = '23505';
  end if;

  select count(*) into v_pending from public.mentorships
  where initiated_by = v_me and status in ('pending', 'discussing');
  if v_pending >= 10 then
    raise exception 'You have too many requests waiting for an answer' using errcode = '54000';
  end if;

  insert into public.mentorships (
    mentor_id, mentee_id, initiated_by, request_message, focus, cadence, duration_months, expected_length
  ) values (
    v_mentor, v_mentee, v_me,
    left(coalesce(p_message, ''), 1000),
    coalesce(p_focus, '{}'::text[]),
    left(coalesce(p_cadence, ''), 60),
    p_duration,
    p_expected_length
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- How long until the first review, based on what was agreed. Inlined into
-- both acceptance paths below rather than a shared helper, so each stays a
-- single readable statement.
create or replace function public.respond_to_mentorship(
  p_id bigint,
  p_action text default null,
  p_message text default '',
  p_cadence text default null,
  p_expected_length text default null,
  p_focus text[] default null,
  p_decline_reason text default '',
  -- p_accept kept for backward compatibility with any in-flight client build
  p_accept boolean default null
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
  v_action text;
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

  v_action := coalesce(p_action, case when p_accept is true then 'accept' when p_accept is false then 'decline' else null end);
  if v_action is null or v_action not in ('accept', 'decline', 'suggest_changes') then
    raise exception 'Unknown action' using errcode = '22023';
  end if;

  if v_action = 'accept' then
    select mentor_capacity into v_capacity from public.profiles where id = m.mentor_id;
    v_active := public.mentor_active_count(m.mentor_id);
    if v_active >= coalesce(v_capacity, 2) then
      raise exception 'AT_CAPACITY' using errcode = '54000';
    end if;

    update public.mentorships
      set status = 'active',
          responded_at = now(),
          started_at = now(),
          response_message = left(coalesce(p_message, ''), 1000),
          review_at = now() + case coalesce(nullif(m.expected_length, ''), 'few_months')
            when 'six_months' then interval '6 months'
            when 'longer_term' then interval '9 months'
            else interval '3 months'
          end
      where id = p_id;

  elsif v_action = 'decline' then
    update public.mentorships
      set status = 'declined',
          responded_at = now(),
          response_message = left(coalesce(p_message, ''), 1000),
          decline_reason = left(coalesce(p_decline_reason, ''), 200)
      where id = p_id;

  else -- suggest_changes
    insert into public.mentorship_terms (mentorship_id, proposed_by, cadence, expected_length, focus, note)
    values (
      p_id, v_me,
      left(coalesce(p_cadence, m.cadence), 60),
      coalesce(p_expected_length, nullif(m.expected_length, ''), 'decide_together'),
      coalesce(p_focus, m.focus),
      left(coalesce(p_message, ''), 1000)
    );
    update public.mentorships set status = 'discussing', responded_at = now() where id = p_id;
  end if;
end;
$$;

-- The original requester accepting or declining a counter-proposal.
create or replace function public.respond_to_mentorship_terms(
  p_id bigint,
  p_action text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  m public.mentorships%rowtype;
  t public.mentorship_terms%rowtype;
  v_capacity smallint;
  v_active int;
begin
  select * into m from public.mentorships where id = p_id;
  if m.id is null then
    raise exception 'Mentorship not found' using errcode = '22023';
  end if;
  if m.status <> 'discussing' then
    raise exception 'Nothing is waiting on your answer' using errcode = '22023';
  end if;
  if v_me <> m.initiated_by then
    raise exception 'Not your request' using errcode = '42501';
  end if;
  if p_action not in ('accept', 'decline') then
    raise exception 'Unknown action' using errcode = '22023';
  end if;

  select * into t from public.mentorship_terms
    where mentorship_id = p_id order by created_at desc limit 1;

  if p_action = 'decline' then
    update public.mentorships set status = 'declined', responded_at = now() where id = p_id;
    return;
  end if;

  select mentor_capacity into v_capacity from public.profiles where id = m.mentor_id;
  v_active := public.mentor_active_count(m.mentor_id);
  if v_active >= coalesce(v_capacity, 2) then
    raise exception 'AT_CAPACITY' using errcode = '54000';
  end if;

  update public.mentorships
    set status = 'active',
        started_at = now(),
        cadence = coalesce(t.cadence, cadence),
        expected_length = coalesce(nullif(t.expected_length, ''), expected_length),
        focus = coalesce(t.focus, focus),
        review_at = now() + case coalesce(nullif(t.expected_length, ''), nullif(m.expected_length, ''), 'few_months')
          when 'six_months' then interval '6 months'
          when 'longer_term' then interval '9 months'
          else interval '3 months'
        end
    where id = p_id;
end;
$$;

-- Withdrawing a request you sent — now also possible while a counter is on
-- the table, not only while it's untouched.
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
  if m.status not in ('pending', 'discussing') then
    raise exception 'This request has already been answered' using errcode = '22023';
  end if;

  update public.mentorships
    set status = 'cancelled', responded_at = now()
    where id = p_id;
end;
$$;

-- Ending an active mentorship with a human reason, replacing the old
-- completed/ended-only end_mentorship for new callers (kept in place too,
-- since it's a strict subset of behaviour and nothing else calls it).
create or replace function public.wrap_up_mentorship(
  p_id bigint,
  p_outcome text,
  p_reflection text default ''
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
  if p_outcome not in ('achieved', 'natural_stop', 'not_right_fit') then
    raise exception 'Unknown outcome' using errcode = '22023';
  end if;

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
    set status = case when p_outcome = 'not_right_fit' then 'ended' else 'completed' end,
        outcome = p_outcome,
        reflection = left(coalesce(p_reflection, ''), 1000),
        ended_at = now(),
        ended_by = v_me
    where id = p_id;
end;
$$;

create or replace function public.submit_mentorship_checkin(
  p_mentorship_id bigint,
  p_response text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
begin
  if p_response not in ('very_useful', 'useful', 'needs_adjustment', 'ready_to_wrap') then
    raise exception 'Unknown response' using errcode = '22023';
  end if;
  if not (select public.is_active_mentorship_member(p_mentorship_id)) then
    raise exception 'Not your mentorship' using errcode = '42501';
  end if;

  insert into public.mentorship_checkins (mentorship_id, profile_id, response)
  values (p_mentorship_id, v_me, p_response);
end;
$$;

-- ============================================================
-- 12. Notifications
-- ============================================================
-- Rewritten to also cover 'discussing', and to stop notifying on every
-- logged session (rule 52) — only when it actually sets a next date, which
-- is the one part of logging a session the other person couldn't already
-- see for themselves in the room.
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

  if new.status = 'discussing' then
    v_actor := case when new.initiated_by = new.mentor_id then new.mentee_id else new.mentor_id end;
    v_target := new.initiated_by;
    select full_name into v_actor_name from public.profiles where id = v_actor;
    v_message := coalesce(v_actor_name, 'Someone') || ' suggested changes to your mentorship request.';
  elsif new.status in ('active', 'declined') then
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
        else ' wrapped up your mentorship.'
      end;
  else
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
  if new.next_conversation_at is null then return new; end if;

  select * into m from public.mentorships where id = new.mentorship_id;
  if m.id is null then return new; end if;

  v_target := case when new.logged_by = m.mentor_id then m.mentee_id else m.mentor_id end;
  if v_target is null or v_target = new.logged_by then return new; end if;

  select full_name into v_actor_name from public.profiles where id = new.logged_by;

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (
    v_target, new.logged_by, 'mentorship_session', 'mentorship', m.id,
    coalesce(v_actor_name, 'Someone') || ' suggested ' ||
      to_char(new.next_conversation_at, 'DD Mon') || ' for your next conversation.'
  );
  return new;
exception when others then
  raise warning 'notify_mentorship_session failed for % — %', new.id, sqlerrm;
  return new;
end;
$$;

create or replace function public.notify_mentoring_connection_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor_name text;
begin
  select full_name into v_actor_name from public.profiles where id = new.requester_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (
    new.recipient_id, new.requester_id,
    case new.kind when 'question' then 'mentoring_question' else 'mentoring_conversation' end,
    'mentorship_connection', new.id,
    coalesce(v_actor_name, 'Someone') ||
      case new.kind
        when 'question' then ' asked you a quick question.'
        else ' suggested a conversation.'
      end
  );
  return new;
exception when others then
  raise warning 'notify_mentoring_connection_request failed for % — %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists mentorship_connections_notify_request on public.mentorship_connections;
create trigger mentorship_connections_notify_request
  after insert on public.mentorship_connections
  for each row execute function public.notify_mentoring_connection_request();

create or replace function public.notify_mentoring_connection_response()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor_name text;
  v_message text;
begin
  if new.status = old.status then return new; end if;
  if new.status not in ('answered', 'scheduled', 'declined') then return new; end if;

  select full_name into v_actor_name from public.profiles where id = new.recipient_id;
  v_message := coalesce(v_actor_name, 'Someone') ||
    case new.status
      when 'answered' then ' answered your question.'
      when 'scheduled' then ' suggested a time for your conversation.'
      else ' can''t do this one — see your other recommendations.'
    end;

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (new.requester_id, new.recipient_id, 'mentoring_connection_response', 'mentorship_connection', new.id, v_message);
  return new;
exception when others then
  raise warning 'notify_mentoring_connection_response failed for % — %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists mentorship_connections_notify_response on public.mentorship_connections;
create trigger mentorship_connections_notify_response
  after update of status on public.mentorship_connections
  for each row execute function public.notify_mentoring_connection_response();

-- ============================================================
-- 13. Admin analytics — aggregate only, no private content
-- ============================================================
create or replace function public.mentoring_admin_stats()
returns table (
  seeking_guidance_count integer,
  offering_guidance_count integer,
  questions_sent integer,
  questions_answered integer,
  conversations_arranged integer,
  mentorship_requests integer,
  mentorships_accepted integer,
  active_mentorships integer,
  completed_mentorships integer,
  inactive_mentorships integer,
  median_duration_days numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    (select count(*)::int from public.profiles where seeking_mentor),
    (select count(*)::int from public.profiles where is_open_to_opportunities),
    (select count(*)::int from public.mentorship_connections where kind = 'question'),
    (select count(*)::int from public.mentorship_connections where kind = 'question' and status = 'answered'),
    (select count(*)::int from public.mentorship_connections where kind = 'conversation' and status = 'scheduled'),
    (select count(*)::int from public.mentorships),
    (select count(*)::int from public.mentorships where status in ('active', 'completed', 'ended')),
    (select count(*)::int from public.mentorships where status = 'active'),
    (select count(*)::int from public.mentorships where status = 'completed'),
    (select count(*)::int from public.mentorships
      where status = 'active'
        and coalesce(last_interaction_at, started_at) < now() - interval '45 days'),
    (select percentile_cont(0.5) within group (order by extract(epoch from (coalesce(ended_at, now()) - started_at)) / 86400)
      from public.mentorships where started_at is not null);
$$;

revoke all on function public.mentoring_admin_stats() from public;
grant execute on function public.mentoring_admin_stats() to authenticated;

-- ============================================================
-- 14. Grants
-- ============================================================
revoke all on function public.request_mentorship(uuid, boolean, text, text[], text, smallint, text) from public;
revoke all on function public.respond_to_mentorship(bigint, text, text, text, text, text[], text, boolean) from public;
revoke all on function public.respond_to_mentorship_terms(bigint, text) from public;
revoke all on function public.cancel_mentorship_request(bigint) from public;
revoke all on function public.wrap_up_mentorship(bigint, text, text) from public;
revoke all on function public.submit_mentorship_checkin(bigint, text) from public;
revoke all on function public.send_mentoring_connection(uuid, text, text, smallint) from public;
revoke all on function public.respond_mentoring_connection(bigint, text, text, timestamptz) from public;

grant execute on function public.request_mentorship(uuid, boolean, text, text[], text, smallint, text) to authenticated;
grant execute on function public.respond_to_mentorship(bigint, text, text, text, text, text[], text, boolean) to authenticated;
grant execute on function public.respond_to_mentorship_terms(bigint, text) to authenticated;
grant execute on function public.cancel_mentorship_request(bigint) to authenticated;
grant execute on function public.wrap_up_mentorship(bigint, text, text) to authenticated;
grant execute on function public.submit_mentorship_checkin(bigint, text) to authenticated;
grant execute on function public.send_mentoring_connection(uuid, text, text, smallint) to authenticated;
grant execute on function public.respond_mentoring_connection(bigint, text, text, timestamptz) to authenticated;
