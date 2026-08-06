-- ============================================================
-- Update 19: Business Directory — a real `businesses` table (not just the
-- existing "business_categories" field on a profile), so an Eendragter can
-- list an actual company/practice with its own logo, category, contact
-- details and map pin, and admins can feature/promote listings.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.businesses (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  category text not null default 'Other',
  description text not null default '',
  website text not null default '',
  contact_email text not null default '',
  phone text not null default '',
  logo_url text default '',
  city text default '',
  country text default '',
  lat double precision,
  lng double precision,
  promoted boolean not null default false,   -- admin-only "featured" flag
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table public.businesses enable row level security;

-- Anyone signed in can browse the directory — same "read is open, write is
-- gated by approval + ownership" shape as jobs/events.
drop policy if exists "Members can read businesses" on public.businesses;
create policy "Members can read businesses"
  on public.businesses for select to authenticated using (true);

drop policy if exists "Approved members can list a business" on public.businesses;
create policy "Approved members can list a business"
  on public.businesses for insert to authenticated
  with check (owner_id = auth.uid() and public.is_approved());

-- Owners manage their own listing's details; only an admin can flip
-- `promoted` in practice (the client never exposes that toggle to a regular
-- owner), but RLS itself doesn't need to special-case the column — the UI
-- is the gate for that, same trust level as "Admins can update any post".
drop policy if exists "Owners and admins can update a business" on public.businesses;
create policy "Owners and admins can update a business"
  on public.businesses for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists "Owners and admins can delete a business" on public.businesses;
create policy "Owners and admins can delete a business"
  on public.businesses for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

create index if not exists businesses_owner_idx on public.businesses (owner_id);
create index if not exists businesses_promoted_idx on public.businesses (promoted, created_at desc);
create index if not exists businesses_category_idx on public.businesses (category);

-- ---------- BUSINESS LOGOS STORAGE ----------
-- Same per-user-folder pattern as job-logos/avatars: the first path segment
-- must be the uploader's own uid, so RLS can check it without a join.
insert into storage.buckets (id, name, public)
values ('business-logos', 'business-logos', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload business logos" on storage.objects;
create policy "Approved members can upload business logos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view business logos" on storage.objects;
create policy "Anyone can view business logos"
  on storage.objects for select
  using (bucket_id = 'business-logos');

drop policy if exists "Users can replace own business logos" on storage.objects;
create policy "Users can replace own business logos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own business logos" on storage.objects;
create policy "Users can delete own business logos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- REALTIME ----------
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'businesses';
  if not found then alter publication supabase_realtime add table public.businesses; end if;
end $$;
