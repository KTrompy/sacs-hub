-- ============================================================
-- Update 0: Baseline (tables, functions and triggers that the Eendrag
--                    project set up via the Supabase Dashboard on day one
--                    and were never captured as SQL).
--
-- Every subsequent migration (schema-update-1 onwards) assumes these
-- exist. Safe to re-run: everything uses IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================

-- ---------- Tables ----------

-- Minimum profiles table that later migrations will extend.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null default '',
  grad_year    integer,
  section      text,
  occupation   text default '',
  city         text default '',
  bio          text default '',
  approved     boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- posts / conversations / conversation_participants / messages: created
-- by the Dashboard originally, then only ALTERed by later migrations.
create table if not exists public.posts (
  id          bigint primary key generated always as identity,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  content     text not null check (char_length(content) between 1 and 4000),
  created_at  timestamptz not null default now(),
  title       text default '',
  image_urls  text[] default '{}',
  video_url   text,
  updated_at  timestamptz,
  pinned      boolean not null default false
);
alter table public.posts enable row level security;

create table if not exists public.conversations (
  id          bigint primary key generated always as identity,
  created_at  timestamptz not null default now()
);
alter table public.conversations enable row level security;

create table if not exists public.conversation_participants (
  conversation_id bigint not null references public.conversations(id) on delete cascade,
  user_id         uuid   not null references public.profiles(id)       on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.conversation_participants enable row level security;

create table if not exists public.messages (
  id              bigint primary key generated always as identity,
  conversation_id bigint not null references public.conversations(id) on delete cascade,
  sender_id       uuid   not null references public.profiles(id)      on delete cascade,
  content         text not null,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  constraint messages_content_length_or_deleted check (
    deleted_at is not null
    or (char_length(content) between 1 and 4000)
  )
);
alter table public.messages enable row level security;

-- ---------- Baseline RLS on profiles ----------

drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------- Helper functions used by later migrations' RLS ----------

-- `is_approved` was Dashboard-only on Eendrag; baseline here.
-- `is_admin` is CREATE OR REPLACEd by a later migration; the plpgsql stub
-- below tolerates the column not existing until then.
-- `is_participant` is first CALLED in mig 29 but not CREATED until mig 51.

create or replace function public.is_approved()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v boolean;
begin
  select approved into v from public.profiles where id = auth.uid();
  return coalesce(v, false);
exception when undefined_column then
  return false;
end;
$$;

create or replace function public.is_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v boolean;
begin
  select is_admin into v from public.profiles where id = auth.uid();
  return coalesce(v, false);
exception when undefined_column then
  return false;
end;
$$;

create or replace function public.is_participant(conv_id bigint, uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select uid = (select auth.uid()) and exists (
    select 1 from public.conversation_participants
    where conversation_id = conv_id and user_id = uid
  );
$$;

-- ---------- handle_new_user function + auth trigger ----------

-- Stub — later migrations (15, 45, 46, 47, 49, 53, 57) CREATE OR REPLACE
-- with the full-fat version that also copies address/city/consent metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(m->>'full_name'), ''),
      nullif(btrim(m->>'name'), ''),
      ''
    )
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'handle_new_user (baseline) failed for % — %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
