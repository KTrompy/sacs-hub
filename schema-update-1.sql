-- ============================================================
-- Update 1: company field + profile photos
-- Run this in Supabase SQL Editor (your existing data is untouched)
-- ============================================================

-- New profile columns
alter table public.profiles add column if not exists company text default '';
alter table public.profiles add column if not exists avatar_url text default '';

-- Storage bucket for profile photos (public read so <img> tags work)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Members can upload/replace only their own photo (path must start with their user id)
create policy "Users can upload own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Anyone can view avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');
