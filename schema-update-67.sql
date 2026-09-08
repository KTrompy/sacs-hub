-- ============================================================
-- Update 67: Broadcast email images -- newsletter-style admin emails.
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Context:
--   The Admin -> Members "Email N selected" broadcast (schema-update-66,
--   send-broadcast-email) could only send plain text. It's being upgraded
--   to a full rich-text/newsletter composer (headings, bold/italic/
--   underline, lists, links, and inline images) so an admin can build
--   something closer to the SACS OBU newsletter emails members already
--   get from AlumNet, instead of a single unformatted paragraph.
--
--   Inline images need a public URL an outgoing email's <img> tag can
--   point at -- the recipient's mail client fetches it directly, the
--   same way any marketing email's images work. That means a public
--   bucket, same shape as legend-photos (schema-update-54): public read,
--   admin-only write, with a size/mime limit from day one.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'broadcast-email-images', 'broadcast-email-images', true,
  5242880, -- 5 MB, same ceiling as legend-photos
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can read broadcast email images" on storage.objects;
create policy "Anyone can read broadcast email images"
  on storage.objects for select
  using (bucket_id = 'broadcast-email-images');

-- Admin-only, matching who can open the composer this feeds. No
-- `(storage.foldername(name))[1] = auth.uid()` ownership scoping -- these
-- images belong to the announcement, not to whichever admin uploaded them,
-- so any admin can replace or remove one (same reasoning as legend-photos).
drop policy if exists "Admins can upload broadcast email images" on storage.objects;
create policy "Admins can upload broadcast email images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'broadcast-email-images' and public.is_admin());

drop policy if exists "Admins can update broadcast email images" on storage.objects;
create policy "Admins can update broadcast email images"
  on storage.objects for update to authenticated
  using (bucket_id = 'broadcast-email-images' and public.is_admin());

drop policy if exists "Admins can delete broadcast email images" on storage.objects;
create policy "Admins can delete broadcast email images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'broadcast-email-images' and public.is_admin());
