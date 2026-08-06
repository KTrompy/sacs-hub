-- ============================================================
-- Update 7: video posts (replaces "Write article" quick-action
-- in the Feed composer with "Add video" — a pasted YouTube/Vimeo
-- link, embedded in the post)
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.posts
  add column if not exists video_url text;
