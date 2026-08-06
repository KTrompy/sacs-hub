-- ============================================================
-- Update 34: remember the last-used photo crop (zoom, position,
-- rotation, flip, filter/adjustments) so reopening the editor on
-- an existing avatar restores exactly where you left off — like
-- LinkedIn's profile photo editor — instead of resetting to a
-- centered, unzoomed default every time.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.profiles add column if not exists avatar_crop jsonb;

-- No RLS change needed: avatar_crop rides along on the same
-- profiles row/update policy as avatar_url.
