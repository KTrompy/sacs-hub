-- ============================================================
-- Update 23: Event map pins — Events board sidebar now shows a map of
-- upcoming events, which needs coordinates the same way businesses/profiles
-- already do. Geocoded from the event's free-text `location` field on
-- save (may not resolve precisely for very specific addresses, but most
-- should land close enough to be useful).
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.events add column if not exists lat double precision;
alter table public.events add column if not exists lng double precision;
