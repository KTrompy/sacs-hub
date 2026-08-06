-- ============================================================
-- Update 11: remove the mentorship feature
-- Run this in Supabase SQL Editor. Safe to re-run.
-- The app no longer reads or writes these columns (see the "no more
-- mentoring feature" change across Directory/Profile/Onboarding/etc.) —
-- this drops them from the database too. This is destructive: any
-- mentorship data on existing profiles is permanently deleted once you
-- run this.
-- ============================================================

alter table public.profiles drop column if exists available_for_mentorship;
alter table public.profiles drop column if exists mentorship_description;
