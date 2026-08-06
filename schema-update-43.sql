-- Update 43: Remove Merchandise feature entirely
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Full rip-out of the Merchandise/store feature added in
-- schema-update-27.sql (merchandise) and schema-update-31.sql
-- (merch_wishlist): both tables, their storage bucket, and every
-- storage policy scoped to that bucket. Same shape as the Photos and
-- Groups removals (schema-update-39/40.sql).

-- Wishlist first — it has an FK to merchandise, though `drop table ...
-- cascade` below would handle it anyway; being explicit keeps the intent
-- clear.
drop table if exists public.merch_wishlist;
drop table if exists public.merchandise cascade;

-- Storage: drop the policies scoped to merch-images. Supabase blocks
-- direct SQL deletes on storage.objects/buckets (same as the Groups
-- removal in schema-update-40.sql) — empty the bucket from the Supabase
-- dashboard (Storage tab) or the Storage API, then uncomment the lines
-- below to drop it:
drop policy if exists "Public can view merch images" on storage.objects;
drop policy if exists "Admins can upload merch images" on storage.objects;
drop policy if exists "Admins can update merch images" on storage.objects;
drop policy if exists "Admins can delete merch images" on storage.objects;

-- delete from storage.objects where bucket_id = 'merch-images';
-- delete from storage.buckets where id = 'merch-images';
