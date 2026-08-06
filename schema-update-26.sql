-- ============================================================
-- Update 26: Job listing detail page — industry, a general company
-- website link (separate from the apply URL), an optional PDF
-- attachment, an explicit apply-method + secondary email, a closing
-- date for applications, and a map pin (same lat/lng pattern as
-- businesses) so the standalone job page can show a location map.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.jobs add column if not exists industry text default '';
alter table public.jobs add column if not exists company_website text default '';
alter table public.jobs add column if not exists attachment_url text default '';
alter table public.jobs add column if not exists attachment_name text default '';
alter table public.jobs add column if not exists additional_email text default '';
alter table public.jobs add column if not exists closing_date date;
alter table public.jobs add column if not exists lat double precision;
alter table public.jobs add column if not exists lng double precision;

-- ---------- JOB ATTACHMENTS STORAGE (PDF job descriptions) ----------
-- Same per-user-folder pattern as job-logos: the first path segment must be
-- the uploader's own uid, so RLS can check it without a join.
insert into storage.buckets (id, name, public)
values ('job-attachments', 'job-attachments', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload job attachments" on storage.objects;
create policy "Approved members can upload job attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'job-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view job attachments" on storage.objects;
create policy "Anyone can view job attachments"
  on storage.objects for select
  using (bucket_id = 'job-attachments');

drop policy if exists "Users can replace own job attachments" on storage.objects;
create policy "Users can replace own job attachments"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'job-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own job attachments" on storage.objects;
create policy "Users can delete own job attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'job-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
