-- ============================================================
-- Eendrag Alumni Hub — Supabase schema
-- Run this once in the Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- ---------- PROFILES ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  grad_year int,                     -- year they left Eendrag
  section text,                      -- Eendrag section they lived in
  occupation text default '',
  city text default '',
  bio text default '',
  approved boolean not null default false,  -- flip to true in Table Editor to approve an alumnus
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Auto-create a profile row when a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: is the current user an approved member?
create or replace function public.is_approved()
returns boolean
language sql security definer set search_path = public
as $$
  select coalesce((select approved from public.profiles where id = auth.uid()), false);
$$;

-- Profiles policies
create policy "Members can view all profiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and approved = (select approved from public.profiles where id = auth.uid()));
  -- (prevents users from approving themselves)

-- ---------- POSTS ----------
create table public.posts (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);

alter table public.posts enable row level security;

create policy "Members can read posts"
  on public.posts for select to authenticated using (true);

create policy "Approved members can post"
  on public.posts for insert to authenticated
  with check (author_id = auth.uid() and public.is_approved());

create policy "Authors can delete own posts"
  on public.posts for delete to authenticated
  using (author_id = auth.uid());

-- ---------- CONVERSATIONS (1:1 DMs) ----------
create table public.conversations (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);

create table public.conversation_participants (
  conversation_id bigint not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

-- Helper to avoid RLS recursion when checking participation
create or replace function public.is_participant(conv_id bigint, uid uuid)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = conv_id and user_id = uid
  );
$$;

create policy "Participants can view conversations"
  on public.conversations for select to authenticated
  using (public.is_participant(id, auth.uid()));

create policy "Participants can view participant rows"
  on public.conversation_participants for select to authenticated
  using (public.is_participant(conversation_id, auth.uid()));

create policy "Participants can read messages"
  on public.messages for select to authenticated
  using (public.is_participant(conversation_id, auth.uid()));

create policy "Approved participants can send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_participant(conversation_id, auth.uid())
    and public.is_approved()
  );

-- Get an existing 1:1 conversation with another member, or create one.
-- Called from the app via supabase.rpc('get_or_create_conversation', ...)
create or replace function public.get_or_create_conversation(other_user uuid)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  conv bigint;
begin
  if not public.is_approved() then
    raise exception 'Account not yet approved';
  end if;
  if other_user = auth.uid() then
    raise exception 'Cannot message yourself';
  end if;

  select cp1.conversation_id into conv
  from public.conversation_participants cp1
  join public.conversation_participants cp2
    on cp1.conversation_id = cp2.conversation_id
  where cp1.user_id = auth.uid() and cp2.user_id = other_user
  limit 1;

  if conv is null then
    insert into public.conversations default values returning id into conv;
    insert into public.conversation_participants (conversation_id, user_id)
    values (conv, auth.uid()), (conv, other_user);
  end if;

  return conv;
end;
$$;

-- ---------- REALTIME ----------
-- Enable realtime on messages so DMs update live
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.posts;
