-- ============================================================
-- Update 20: Badges — definitions for the "Badges achieved" widget on the
-- Home dashboard. Earned/locked status is computed client-side from
-- existing data (profile completeness, posts, group_members, event_rsvps,
-- photos, mentoring_participants) — this table only holds the badge
-- definitions themselves (name/description/key), so Kyle can edit copy or
-- add new badges from the Supabase Table Editor without a code deploy.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.badges (
  id bigint generated always as identity primary key,
  key text not null unique,          -- matched against in the client's earned-badge logic
  name text not null,
  description text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.badges enable row level security;

drop policy if exists "Members can view badges" on public.badges;
create policy "Members can view badges"
  on public.badges for select to authenticated using (true);

insert into public.badges (key, name, description, sort_order) values
  ('profile_complete', 'Profile Pro', 'Filled out every section of your profile.', 1),
  ('first_post', 'First Post', 'Shared your first update with the house.', 2),
  ('joined_group', 'Group Member', 'Joined your first Eendrag group.', 3),
  ('event_goer', 'Event Goer', 'RSVP''d to an alumni event.', 4),
  ('photo_sharer', 'Photo Sharer', 'Added a photo to an album.', 5),
  ('mentor_connect', 'Mentor Connect', 'Joined the mentoring programme as a mentor or mentee.', 6)
on conflict (key) do nothing;
