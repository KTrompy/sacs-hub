-- ============================================================
-- Update 25: Work experience entries on profiles (repeatable
-- title/company/industry/date blocks, edited from the profile page)
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.profiles add column if not exists experience jsonb default '[]'::jsonb;

-- Each element: { "title": text, "company": text, "industry": text,
--                 "from": "YYYY-MM" or "", "to": "YYYY-MM" or "" (blank = present) }
