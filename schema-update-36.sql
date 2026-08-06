-- ============================================================
-- Update 36: Business profile -> Mentoring. The old "Business
-- categories" field (Founder/Entrepreneur, Investor/Advisor, etc.)
-- was never surfaced in the profile editor — only read-only on
-- PersonProfile/ProfileModal — and doesn't fit the section's new
-- mentoring framing, so it's being dropped rather than carried
-- forward. Everything else that section held (availability,
-- geographic focus, expertise, services offered, business website,
-- open-to-opportunities) is unaffected and keeps its existing column.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.profiles drop column if exists business_categories;
