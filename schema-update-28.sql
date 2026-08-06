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
