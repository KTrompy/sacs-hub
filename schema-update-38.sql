-- ============================================================
-- Update 38: Drop the "Mentoring/Coaching" service tag as a mentor
-- eligibility requirement. Kyle wants a single toggle — "Open to
-- mentoring and other opportunities" (profiles.is_open_to_opportunities)
-- — to be the only thing that puts someone under Find a Mentor. The
-- services-offered tag was a second, redundant gate stacked on top of it
-- (see schema-update-37.sql, which introduced the profile-driven check);
-- this removes that second requirement and drops the tag itself from the
-- SERVICES_OFFERED list in the frontend (constants.js).
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

drop policy if exists "Members can request a mentor" on public.mentoring_matches;

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
    )
  );

-- Nobody had "Mentoring/Coaching" set in services_offered yet (checked
-- before writing this), so there's no stale data to clean up. If that
-- changes before this runs, this strips it out defensively so it doesn't
-- linger as an orphaned value with no UI control left to unset it:
update public.profiles
set services_offered = array_remove(services_offered, 'Mentoring/Coaching')
where services_offered @> array['Mentoring/Coaching']::text[];
