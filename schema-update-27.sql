-- Update 27: Merchandise (Eendrag store)
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- This is an official, admin-curated store (hoodies, mugs, caps, etc.) —
-- unlike jobs/businesses, ordinary members can browse and order but only
-- admins can create/edit/remove listings. "Order" is a contact-to-order
-- flow (an in-app message to whichever admin listed the item), same as
-- Business Directory's "Message about this business" — there is no
-- payment processing anywhere in this app yet (see Donate.jsx), so this
-- deliberately doesn't add one either.

create table if not exists public.merchandise (
  id bigint generated always as identity primary key,
  name text not null,
  description text not null default '',
  price numeric(10,2) not null default 0,
  category text not null default 'Other',
  sizes text[] not null default '{}',
  colors text[] not null default '{}',
  image_url text default '',
  is_available boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.merchandise enable row level security;

drop policy if exists "Anyone signed in can view merchandise" on public.merchandise;
create policy "Anyone signed in can view merchandise"
  on public.merchandise for select
  to authenticated
  using (true);

-- Admin-only writes — the one precedent for this shape elsewhere in the
-- app is jobs/businesses' owner-or-admin OR-policy; here there's no owner
-- half at all, so it's simply public.is_admin() on every write.
drop policy if exists "Admins can create merchandise" on public.merchandise;
create policy "Admins can create merchandise"
  on public.merchandise for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update merchandise" on public.merchandise;
create policy "Admins can update merchandise"
  on public.merchandise for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete merchandise" on public.merchandise;
create policy "Admins can delete merchandise"
  on public.merchandise for delete
  to authenticated
  using (public.is_admin());

-- Storage: item photos, same public-read/scoped-write shape as
-- business-logos/job-logos, except write access is admin-only instead of
-- folder-owner, since only admins ever upload merch photos.
insert into storage.buckets (id, name, public)
values ('merch-images', 'merch-images', true)
on conflict (id) do nothing;

drop policy if exists "Public can view merch images" on storage.objects;
create policy "Public can view merch images"
  on storage.objects for select
  using (bucket_id = 'merch-images');

drop policy if exists "Admins can upload merch images" on storage.objects;
create policy "Admins can upload merch images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'merch-images' and public.is_admin());

drop policy if exists "Admins can update merch images" on storage.objects;
create policy "Admins can update merch images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'merch-images' and public.is_admin());

drop policy if exists "Admins can delete merch images" on storage.objects;
create policy "Admins can delete merch images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'merch-images' and public.is_admin());
