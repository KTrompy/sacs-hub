-- ============================================================
-- Update 12: Add business profile fields
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.profiles
add column if not exists expertise text default '',
add column if not exists services_offered text[] default array[]::text[],
add column if not exists business_website text default '',
add column if not exists looking_to_connect text[] default array[]::text[],
add column if not exists business_categories text[] default array[]::text[];
