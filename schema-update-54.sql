-- schema-update-54.sql — Eendrag legends (home-page spotlight)
--
-- A small, admin-curated hall of fame: notable old boys, shown as a photo
-- mosaic on Home. Deliberately NOT derived from `profiles` — the people this
-- is for are mostly long gone and were never members of the hub, so there is
-- no account to hang any of this off. It is reference content, closer to
-- `badges` than to anything member-owned.
--
-- APPLIED to the live project on 2026-08-02, and verified: the category CHECK
-- rejects a typo'd value, and the updated_at trigger fires on UPDATE.
--
-- Safe to re-run: every statement is guarded or uses "if exists"/"if not
-- exists"/"on conflict do nothing".


/* ---------------------------------------------------------------------------
   The table
   ------------------------------------------------------------------------ */
create table if not exists public.legends (
  id          uuid primary key default gen_random_uuid(),

  -- Displayed as the tile headline, in Georgia. Full name as you want it read.
  name        text not null,

  -- Free text, not two integer columns, because the records this is drawn
  -- from are often vague: "1962–1966" for some, "early 1950s" for others.
  -- Forcing a start/end year would mean either inventing precision the
  -- archive doesn't have, or leaving the field empty for the oldest entries —
  -- which are exactly the ones most worth listing.
  years       text,
  degree      text,

  -- Drives the pill colour on the tile (see .legend-pill-* in styles.css).
  -- Constrained rather than free text so the palette can't drift: a typo'd
  -- "Politcs" would silently fall through to the neutral pill and nobody
  -- would notice for months.
  category    text not null default 'other',

  -- The one-line claim to fame, shown under the name on the tile. This is
  -- the line that has to earn the click, so it's required.
  headline    text not null,

  -- Long-form, shown only in the modal. Plain text with newlines, not HTML —
  -- there's no rich-text editor on this form and no reason to open an
  -- injection surface for content that is three paragraphs of prose.
  story       text,

  photo_url   text,

  -- Optional "read more" out to Wikipedia, an obituary, a news piece.
  link_url    text,
  link_label  text,

  -- `active` hides an entry without deleting it — useful when a story turns
  -- out to be wrong or a family asks for it to come down, and you want the
  -- write-up kept in case it comes back.
  active      boolean not null default true,

  -- Lower sorts first. Ties break on created_at so the order is stable.
  sort_order  integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'legends_category_check'
  ) then
    alter table public.legends
      add constraint legends_category_check check (category in (
        'sport', 'business', 'politics', 'arts', 'academia',
        'military', 'medicine', 'media', 'service', 'other'
      ));
  end if;
end $$;

-- The home page only ever asks for "active legends in display order", so the
-- index matches that query exactly rather than indexing each column alone.
create index if not exists legends_active_order_idx
  on public.legends (active, sort_order, created_at);


/* ---------------------------------------------------------------------------
   RLS

   Read is for approved members. This is house history, not public marketing —
   it sits behind the same wall as the directory, and an inactive entry is
   invisible to everyone but admins (see the `active` note above: hiding
   something must actually hide it, or the flag is decorative).

   Write is admin-only. There is no member-submission flow by design; the
   whole point of curating this is that you decide who counts.
   ------------------------------------------------------------------------ */
alter table public.legends enable row level security;

drop policy if exists "Approved members can read active legends" on public.legends;
create policy "Approved members can read active legends"
  on public.legends for select to authenticated
  using (
    (active and (public.is_approved() or public.is_admin()))
    or public.is_admin()
  );

drop policy if exists "Admins can insert legends" on public.legends;
create policy "Admins can insert legends"
  on public.legends for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update legends" on public.legends;
create policy "Admins can update legends"
  on public.legends for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete legends" on public.legends;
create policy "Admins can delete legends"
  on public.legends for delete to authenticated
  using (public.is_admin());


/* ---------------------------------------------------------------------------
   updated_at

   Set by a trigger rather than by the client, so it can't be forgotten in one
   of the two places Admin.jsx writes to this table (create and edit).
   ------------------------------------------------------------------------ */
create or replace function public.touch_legends_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists legends_touch_updated_at on public.legends;
create trigger legends_touch_updated_at
  before update on public.legends
  for each row execute function public.touch_legends_updated_at();


/* ---------------------------------------------------------------------------
   Storage: legend portraits

   Public bucket, because these are photos rendered directly into <img> tags
   on the home page — the same shape as business-logos and post-images. Unlike
   those, it ships with a size and mime limit from day one (the security audit
   flagged the older buckets for having neither; no reason to add a tenth).

   Uploads are admin-only, matching the table. Nothing here is user-owned, so
   there is no `(storage.foldername(name))[1] = auth.uid()` scoping — admins
   need to be able to replace each other's uploads.
   ------------------------------------------------------------------------ */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'legend-photos', 'legend-photos', true,
  5242880, -- 5 MB, matches MAX_PHOTO_SIZE in Admin.jsx
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can read legend photos" on storage.objects;
create policy "Anyone can read legend photos"
  on storage.objects for select
  using (bucket_id = 'legend-photos');

drop policy if exists "Admins can upload legend photos" on storage.objects;
create policy "Admins can upload legend photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'legend-photos' and public.is_admin());

drop policy if exists "Admins can update legend photos" on storage.objects;
create policy "Admins can update legend photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'legend-photos' and public.is_admin());

drop policy if exists "Admins can delete legend photos" on storage.objects;
create policy "Admins can delete legend photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'legend-photos' and public.is_admin());
