-- ============================================================
-- Update 31: Merchandise wishlist
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Problem this fixes:
--   MerchDetail.jsx's heart/wishlist button only ever toggled local
--   component state — it implied it was saving something, but a refresh
--   silently reset it and it never persisted anywhere. This is the same
--   shape as post_likes (schema-update-2.sql): a plain per-user,
--   per-item join table.
-- ============================================================

create table if not exists public.merch_wishlist (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id bigint not null references public.merchandise(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.merch_wishlist enable row level security;

drop policy if exists "Users can read own wishlist" on public.merch_wishlist;
create policy "Users can read own wishlist"
  on public.merch_wishlist for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can add to own wishlist" on public.merch_wishlist;
create policy "Users can add to own wishlist"
  on public.merch_wishlist for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can remove from own wishlist" on public.merch_wishlist;
create policy "Users can remove from own wishlist"
  on public.merch_wishlist for delete to authenticated
  using (user_id = auth.uid());
