-- ============================================================
-- Update 17: last_seen heartbeat — powers the "Recently online" sort and
-- the green online dot in the Eendragters directory.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.profiles add column if not exists last_seen timestamptz;

-- Already covered by the existing "Users can update own profile" policy
-- (id = auth.uid(), and the with-check only pins `approved` to its current
-- value — it doesn't restrict which other columns change), so no new RLS
-- policy is needed for the app to update its own last_seen on a heartbeat.

create index if not exists profiles_last_seen_idx on public.profiles (last_seen desc);
