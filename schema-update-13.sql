-- ============================================================
-- Update 13: Make "expertise" multi-select (text -> text[])
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Main area of expertise used to be a single value; the profile UI now
-- lets people pick several, scoped to their chosen industry. This
-- converts the column to an array, wrapping any existing single value
-- into a one-item array so no data is lost.
-- ============================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'expertise'
      and data_type <> 'ARRAY'
  ) then
    alter table public.profiles
      alter column expertise drop default;

    alter table public.profiles
      alter column expertise type text[]
      using case
        when expertise is null or expertise = '' then array[]::text[]
        else array[expertise]
      end;

    alter table public.profiles
      alter column expertise set default array[]::text[];
  end if;
end $$;
