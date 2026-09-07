-- ============================================================
-- Update 65: Mentoring — replace the lifecycle system with a simple
-- "browse a mentor directory, contact by email" model.
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Context:
--   Update 64 built out a full mentorship lifecycle (requests, negotiation,
--   active mentorships, sessions, goals, check-ins, a lighter-weight
--   quick-question/conversation tier). That system is being retired in
--   favour of something much simpler: mentors opt in on their profile,
--   appear in a directory, and are contacted directly by email — no
--   in-app relationship, request, or session tracking at all.
--
--   Nothing from update 64 is dropped here. Every table it created
--   (mentorships, mentorship_connections, mentorship_terms,
--   mentorship_actions, mentorship_checkins, saved_mentors,
--   mentoring_profiles) still has zero production rows and is simply no
--   longer written to by the frontend — left in place rather than
--   "blindly deleted", per the standing rule for tables that might still
--   hold something worth inspecting later.
--
--   The new model reuses existing profiles columns almost entirely:
--     mentoring_enabled     -> profiles.is_open_to_opportunities (existing)
--     mentoring_available   -> NOT profiles.mentor_paused        (existing)
--     mentoring_categories  -> profiles.expertise                (existing)
--     mentoring_description -> profiles.mentor_note              (NEW below)
--
--   The one genuinely new thing needed is a free-text field for "anything
--   else you'd like people to know?" — there was no equivalent for mentors
--   before (mentee_note is the mentee-side counterpart and is untouched).
-- ============================================================

alter table public.profiles
  add column if not exists mentor_note text not null default '';

comment on column public.profiles.mentor_note is
  'Free-text "anything else you''d like people to know?" shown on a mentor''s directory profile. Replaces the old structured services_offered picker for mentoring purposes only — services_offered itself is untouched and still used by Directory/Business Directory.';

-- No RLS changes needed: mentor_note is a plain column on profiles, covered
-- by that table's existing select/update policies the same as bio, city,
-- occupation, etc.
