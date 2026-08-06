-- ============================================================
-- Update 15: Groups — browse/join groups, a per-group feed (its own
-- posts/likes/comments), and a Members tab.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- GROUPS ----------
create table if not exists public.groups (
  id bigint generated always as identity primary key,
  name text not null,
  description text not null default '',
  cover_image_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.groups enable row level security;

-- ---------- GROUP MEMBERS ----------
create table if not exists public.group_members (
  group_id bigint not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',  -- 'member' | 'admin'
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_members enable row level security;

-- Helpers (security definer — same recursion-avoidance trick as
-- is_participant() for conversations in schema.sql) so group_posts/likes/
-- comments RLS can check membership without a policy on group_members
-- having to query group_members itself.
create or replace function public.is_group_member(gid bigint, uid uuid)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_members where group_id = gid and user_id = uid
  );
$$;

create or replace function public.is_group_admin(gid bigint, uid uuid)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_members where group_id = gid and user_id = uid and role = 'admin'
  );
$$;

-- Groups policies: every approved member can see every group (so there's
-- something to discover/join), and can create a new one. Only that group's
-- own admins (or a site admin) can edit/delete it.
drop policy if exists "Members can read groups" on public.groups;
create policy "Members can read groups"
  on public.groups for select to authenticated using (true);

drop policy if exists "Approved members can create groups" on public.groups;
create policy "Approved members can create groups"
  on public.groups for insert to authenticated
  with check (created_by = auth.uid() and public.is_approved());

drop policy if exists "Group admins can update their group" on public.groups;
create policy "Group admins can update their group"
  on public.groups for update to authenticated
  using (public.is_group_admin(id, auth.uid()))
  with check (public.is_group_admin(id, auth.uid()));

drop policy if exists "Group admins can delete their group" on public.groups;
create policy "Group admins can delete their group"
  on public.groups for delete to authenticated
  using (public.is_group_admin(id, auth.uid()));

drop policy if exists "Site admins can delete any group" on public.groups;
create policy "Site admins can delete any group"
  on public.groups for delete to authenticated
  using (public.is_admin());

-- Group membership policies: anyone can see who's in a group (member
-- counts, the Members tab); any approved member can join themselves or
-- leave; a group admin can remove others or change roles.
drop policy if exists "Members can read group membership" on public.group_members;
create policy "Members can read group membership"
  on public.group_members for select to authenticated using (true);

drop policy if exists "Approved members can join a group" on public.group_members;
create policy "Approved members can join a group"
  on public.group_members for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists "Members can leave a group" on public.group_members;
create policy "Members can leave a group"
  on public.group_members for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "Group admins can remove members" on public.group_members;
create policy "Group admins can remove members"
  on public.group_members for delete to authenticated
  using (public.is_group_admin(group_id, auth.uid()));

drop policy if exists "Group admins can change member roles" on public.group_members;
create policy "Group admins can change member roles"
  on public.group_members for update to authenticated
  using (public.is_group_admin(group_id, auth.uid()))
  with check (public.is_group_admin(group_id, auth.uid()));

-- Whoever creates a group is auto-added as its first admin — otherwise a
-- brand new group would start with zero members and nobody able to manage
-- it (only a group admin can add members, but there'd be no admin yet).
create or replace function public.handle_new_group()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'admin')
  on conflict (group_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_new_group_admin on public.groups;
create trigger trg_new_group_admin
  after insert on public.groups
  for each row execute function public.handle_new_group();

-- ---------- GROUP POSTS (each group has its own mini feed) ----------
create table if not exists public.group_posts (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text default '',
  content text not null default '',
  image_urls text[] not null default array[]::text[],
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table public.group_posts enable row level security;

drop policy if exists "Group members can read group posts" on public.group_posts;
create policy "Group members can read group posts"
  on public.group_posts for select to authenticated
  using (public.is_group_member(group_id, auth.uid()));

drop policy if exists "Group members can post" on public.group_posts;
create policy "Group members can post"
  on public.group_posts for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.is_group_member(group_id, auth.uid())
    and public.is_approved()
  );

drop policy if exists "Authors can update own group posts" on public.group_posts;
create policy "Authors can update own group posts"
  on public.group_posts for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "Group admins can update any group post" on public.group_posts;
create policy "Group admins can update any group post"
  on public.group_posts for update to authenticated
  using (public.is_group_admin(group_id, auth.uid()))
  with check (public.is_group_admin(group_id, auth.uid()));

drop policy if exists "Authors can delete own group posts" on public.group_posts;
create policy "Authors can delete own group posts"
  on public.group_posts for delete to authenticated
  using (author_id = auth.uid());

drop policy if exists "Group admins can delete any group post" on public.group_posts;
create policy "Group admins can delete any group post"
  on public.group_posts for delete to authenticated
  using (public.is_group_admin(group_id, auth.uid()));

drop policy if exists "Site admins can delete any group post" on public.group_posts;
create policy "Site admins can delete any group post"
  on public.group_posts for delete to authenticated
  using (public.is_admin());

-- ---------- GROUP POST LIKES ----------
create table if not exists public.group_post_likes (
  post_id bigint not null references public.group_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.group_post_likes enable row level security;

drop policy if exists "Group members can read group post likes" on public.group_post_likes;
create policy "Group members can read group post likes"
  on public.group_post_likes for select to authenticated
  using (exists (
    select 1 from public.group_posts gp
    where gp.id = post_id and public.is_group_member(gp.group_id, auth.uid())
  ));

drop policy if exists "Group members can like group posts" on public.group_post_likes;
create policy "Group members can like group posts"
  on public.group_post_likes for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_approved()
    and exists (
      select 1 from public.group_posts gp
      where gp.id = post_id and public.is_group_member(gp.group_id, auth.uid())
    )
  );

drop policy if exists "Users can unlike group posts" on public.group_post_likes;
create policy "Users can unlike group posts"
  on public.group_post_likes for delete to authenticated
  using (user_id = auth.uid());

-- ---------- GROUP POST COMMENTS ----------
create table if not exists public.group_post_comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.group_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.group_post_comments enable row level security;

drop policy if exists "Group members can read group post comments" on public.group_post_comments;
create policy "Group members can read group post comments"
  on public.group_post_comments for select to authenticated
  using (exists (
    select 1 from public.group_posts gp
    where gp.id = post_id and public.is_group_member(gp.group_id, auth.uid())
  ));

drop policy if exists "Group members can comment" on public.group_post_comments;
create policy "Group members can comment"
  on public.group_post_comments for insert to authenticated
  with check (
    author_id = auth.uid() and public.is_approved()
    and exists (
      select 1 from public.group_posts gp
      where gp.id = post_id and public.is_group_member(gp.group_id, auth.uid())
    )
  );

drop policy if exists "Authors can delete own group post comments" on public.group_post_comments;
create policy "Authors can delete own group post comments"
  on public.group_post_comments for delete to authenticated
  using (author_id = auth.uid());

drop policy if exists "Group admins can delete any group post comment" on public.group_post_comments;
create policy "Group admins can delete any group post comment"
  on public.group_post_comments for delete to authenticated
  using (exists (
    select 1 from public.group_posts gp
    where gp.id = post_id and public.is_group_admin(gp.group_id, auth.uid())
  ));

drop policy if exists "Site admins can delete any group post comment" on public.group_post_comments;
create policy "Site admins can delete any group post comment"
  on public.group_post_comments for delete to authenticated
  using (public.is_admin());

-- ---------- STORAGE: group cover images + group post images ----------
insert into storage.buckets (id, name, public)
values ('group-covers', 'group-covers', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload group covers" on storage.objects;
create policy "Approved members can upload group covers"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'group-covers' and public.is_approved());

drop policy if exists "Anyone can view group covers" on storage.objects;
create policy "Anyone can view group covers"
  on storage.objects for select using (bucket_id = 'group-covers');

drop policy if exists "Uploaders can replace group covers" on storage.objects;
create policy "Uploaders can replace group covers"
  on storage.objects for update to authenticated
  using (bucket_id = 'group-covers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Uploaders can delete group covers" on storage.objects;
create policy "Uploaders can delete group covers"
  on storage.objects for delete to authenticated
  using (bucket_id = 'group-covers' and (storage.foldername(name))[1] = auth.uid()::text);

insert into storage.buckets (id, name, public)
values ('group-post-images', 'group-post-images', true)
on conflict (id) do nothing;

drop policy if exists "Approved members can upload group post images" on storage.objects;
create policy "Approved members can upload group post images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'group-post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

drop policy if exists "Anyone can view group post images" on storage.objects;
create policy "Anyone can view group post images"
  on storage.objects for select using (bucket_id = 'group-post-images');

drop policy if exists "Users can delete own group post images" on storage.objects;
create policy "Users can delete own group post images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'group-post-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- REALTIME ----------
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_posts';
  if not found then alter publication supabase_realtime add table public.group_posts; end if;
end $$;
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_members';
  if not found then alter publication supabase_realtime add table public.group_members; end if;
end $$;
