-- ============================================================
-- Update 22: Business Directory listing upgrade — a short tagline/headline
-- shown above the "Read more" excerpt, and a separate big cover image
-- (distinct from the small logo) that displays before the business name on
-- both the card preview and the new standalone listing page.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.businesses add column if not exists tagline text not null default '';
alter table public.businesses add column if not exists cover_image_url text default '';

-- ---------- BUSINESS COVER IMAGES STORAGE ----------
-- Same per-user-folder pattern as business-logos: the first path segment
-- must be the uploader's own uid, so RLS can check it without a join.
insert into storage.buckets (id, name, public)
values ('business-covers', 'business-covers', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload business covers" on storage.objects;
create policy "Approved members can upload business covers"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'business-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view business covers" on storage.objects;
create policy "Anyone can view business covers"
  on storage.objects for select
  using (bucket_id = 'business-covers');

drop policy if exists "Users can replace own business covers" on storage.objects;
create policy "Users can replace own business covers"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'business-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own business covers" on storage.objects;
create policy "Users can delete own business covers"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'business-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
