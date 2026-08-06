-- ============================================================
-- Update 24: Enhanced event editing — start/end times, URL, image, registration limit
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- Add new event fields for enhanced editing
alter table public.events add column if not exists event_start_time timestamptz;
alter table public.events add column if not exists event_end_time timestamptz;
alter table public.events add column if not exists event_url text default '';
alter table public.events add column if not exists image_url text default '';
alter table public.events add column if not exists max_registrations integer;  -- null = unlimited

-- Note: existing event_date column becomes the start date if migrating old events.
-- Consider a backfill script if needed to populate event_start_time from event_date.

-- Storage bucket for event images
insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do nothing;

-- Policies for event image uploads
drop policy if exists "Approved members can upload event images" on storage.objects;
create policy "Approved members can upload event images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view event images" on storage.objects;
create policy "Anyone can view event images"
  on storage.objects for select
  using (bucket_id = 'event-images');

drop policy if exists "Users can delete own event images" on storage.objects;
create policy "Users can delete own event images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
