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
