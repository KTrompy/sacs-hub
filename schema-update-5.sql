-- ============================================================
-- Update 5: coordinates for the alumni map
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- Latitude/longitude for the city on each profile, filled in automatically
-- (client-side, via OpenStreetMap's free Nominatim geocoder) whenever a
-- member saves their profile with a new city/country. Nullable — plenty of
-- profiles won't have it yet, and the map just skips those.
alter table public.profiles add column if not exists lat double precision;
alter table public.profiles add column if not exists lng double precision;

-- No new RLS policies needed: lat/lng ride along on the existing
-- "Users can update own profile" / "Members can view all profiles" policies.
