-- ============================================================
-- Update 40: Remove Groups feature entirely.
-- Drops tables, functions, triggers, storage buckets, RLS
-- policies, the joined_group badge, and the group_post report
-- type. Safe to re-run.
-- ============================================================

-- ---------- 1. Remove from realtime publication ----------
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_posts';
  if found then alter publication supabase_realtime drop table public.group_posts; end if;
end $$;
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_members';
  if found then alter publication supabase_realtime drop table public.group_members; end if;
end $$;

-- ---------- 2. Drop trigger + functions ----------
drop trigger if exists trg_new_group_admin on public.groups;
drop function if exists public.handle_new_group() cascade;
drop function if exists public.is_group_admin(bigint, uuid) cascade;
drop function if exists public.is_group_member(bigint, uuid) cascade;

-- ---------- 3. Drop tables (cascade removes RLS policies + FKs) ----------
drop table if exists public.group_post_comments cascade;
drop table if exists public.group_post_likes cascade;
drop table if exists public.group_posts cascade;
drop table if exists public.group_members cascade;
drop table if exists public.groups cascade;

-- ---------- 4. Storage: remove policies then buckets ----------
-- group-covers policies
drop policy if exists "Approved members can upload group covers" on storage.objects;
drop policy if exists "Anyone can view group covers" on storage.objects;
drop policy if exists "Uploaders can replace group covers" on storage.objects;
drop policy if exists "Uploaders can delete group covers" on storage.objects;

-- group-post-images policies
drop policy if exists "Approved members can upload group post images" on storage.objects;
drop policy if exists "Anyone can view group post images" on storage.objects;
drop policy if exists "Users can delete own group post images" on storage.objects;

-- Supabase blocks direct SQL deletes on storage.objects — empty
-- these two buckets from the Supabase dashboard (Storage tab) or
-- the Storage API, then uncomment the lines below to drop them:
-- delete from storage.buckets where id = 'group-covers';
-- delete from storage.buckets where id = 'group-post-images';

-- ---------- 5. Remove joined_group badge ----------
delete from public.badges where key = 'joined_group';

-- ---------- 6. Remove group_post from reports check constraint ----------
-- Replace the existing check constraint with one that excludes group_post.
do $$
begin
  -- Drop the old constraint (Postgres names it reports_entity_type_check
  -- by default for a column-level CHECK).
  alter table public.reports drop constraint if exists reports_entity_type_check;
  -- Re-add without group_post.
  alter table public.reports
    add constraint reports_entity_type_check
    check (entity_type in ('post', 'job', 'business', 'profile'));
  -- Clean up any existing group_post reports so the new constraint holds.
  delete from public.reports where entity_type = 'group_post';
exception
  when undefined_table then null; -- reports table doesn't exist yet
end $$;
