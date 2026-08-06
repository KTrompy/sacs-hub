-- ============================================================
-- Update 32: Batched mentoring match counts
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Problem this fixes:
--   Mentoring.jsx's load() called the mentoring_match_count(pid) RPC once
--   per program (via Promise.all) just to show each program's match count
--   in the Programs tab — an N+1 query pattern where a site with 20
--   mentoring programs fired 20 separate round trips to render 20 numbers.
--   This adds a batched equivalent that takes every program id at once and
--   returns one row per program, so the frontend can do it in a single
--   call instead. mentoring_match_count(bigint) (schema-update-18.sql) is
--   left in place — nothing else references it, but there's no need to
--   drop it.
-- ============================================================

create or replace function public.mentoring_match_counts(pids bigint[])
returns table (program_id bigint, cnt bigint)
language sql security definer set search_path = public
as $$
  select p as program_id, count(m.id) as cnt
  from unnest(pids) as p
  left join public.mentoring_matches m
    on m.program_id = p and m.status in ('active', 'completed')
  group by p;
$$;

grant execute on function public.mentoring_match_counts(bigint[]) to authenticated;
