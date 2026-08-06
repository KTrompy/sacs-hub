-- ============================================================
-- Update 16: Photos — shared albums the whole house can browse and add to.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.photo_albums (
  id bigint generated always as identity primary key,
  title text not null,
  description text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.photo_albums enable row level security;

create table if not exists public.photos (
  id bigint generated always as identity primary key,
  album_id bigint not null references public.photo_albums(id) on delete cascade,
  url text not null,
  caption text default '',
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.photos enable row level security;

-- Albums: every approved member can see and create albums, and can edit/
-- delete an album they created. Site admins can moderate any album.
drop policy if exists "Members can read albums" on public.photo_albums;
create policy "Members can read albums"
  on public.photo_albums for select to authenticated using (true);

drop policy if exists "Approved members can create albums" on public.photo_albums;
create policy "Approved members can create albums"
  on public.photo_albums for insert to authenticated
  with check (created_by = auth.uid() and public.is_approved());

drop policy if exists "Creators can update own albums" on public.photo_albums;
create policy "Creators can update own albums"
  on public.photo_albums for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "Creators can delete own albums" on public.photo_albums;
create policy "Creators can delete own albums"
  on public.photo_albums for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists "Site admins can delete any album" on public.photo_albums;
create policy "Site admins can delete any album"
  on public.photo_albums for delete to authenticated
  using (public.is_admin());

-- Photos: every approved member can see all photos and add photos to any
-- album (a shared album is meant to be added to by everyone, like the
-- reference's "Campus Life" album) — but can only remove photos they
-- personally uploaded (plus the album's creator and site admins, who can
-- clean up anything in/under their own album).
drop policy if exists "Members can read photos" on public.photos;
create policy "Members can read photos"
  on public.photos for select to authenticated using (true);

drop policy if exists "Approved members can add photos" on public.photos;
create policy "Approved members can add photos"
  on public.photos for insert to authenticated
  with check (uploaded_by = auth.uid() and public.is_approved());

drop policy if exists "Uploaders can delete own photos" on public.photos;
create policy "Uploaders can delete own photos"
  on public.photos for delete to authenticated
  using (uploaded_by = auth.uid());

drop policy if exists "Album creators can delete photos in their album" on public.photos;
create policy "Album creators can delete photos in their album"
  on public.photos for delete to authenticated
  using (exists (
    select 1 from public.photo_albums a where a.id = album_id and a.created_by = auth.uid()
  ));

drop policy if exists "Site admins can delete any photo" on public.photos;
create policy "Site admins can delete any photo"
  on public.photos for delete to authenticated
  using (public.is_admin());

-- ---------- STORAGE: album photos ----------
insert into storage.buckets (id, name, public)
values ('album-photos', 'album-photos', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload album photos" on storage.objects;
create policy "Approved members can upload album photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'album-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view album photos" on storage.objects;
create policy "Anyone can view album photos"
  on storage.objects for select using (bucket_id = 'album-photos');

drop policy if exists "Users can delete own album photo files" on storage.objects;
create policy "Users can delete own album photo files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create index if not exists photos_album_idx on public.photos (album_id, created_at desc);
