-- ============================================================
-- Update 14: pinned posts on the Feed page.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.posts add column if not exists pinned boolean not null default false;

-- Admins can update ANY post (to pin/unpin it) — additive alongside
-- "Authors can update own posts" (schema-update-9.sql). Postgres OR's
-- permissive policies together, so this doesn't loosen what authors can do
-- to their own posts, it only adds a path for admins to flip `pinned` on
-- someone else's post. Same pattern as "Admins can update any profile" in
-- schema-update-8.sql.
drop policy if exists "Admins can update any post" on public.posts;
create policy "Admins can update any post"
  on public.posts for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Pinned posts are rare and always fetched in their own small query
-- (see Feed.jsx) — this keeps that lookup cheap regardless of table size.
create index if not exists posts_pinned_idx on public.posts (pinned) where pinned;
