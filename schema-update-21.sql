-- ============================================================
-- Update 21: Settings page — phone number + granular privacy controls,
-- real notification preferences (in-app "Platform" channel only — no
-- email-sending service or native mobile app exist yet, so Email/Mobile
-- toggles in the UI are cosmetic and don't need backend support here),
-- and self-service account deletion.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- PROFILE FIELDS ----------
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists language text not null default 'en';

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'privacy_phone') then
    alter table public.profiles add column privacy_phone text not null default 'all';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'privacy_email') then
    alter table public.profiles add column privacy_email text not null default 'all';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'privacy_location') then
    alter table public.profiles add column privacy_location text not null default 'all';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'privacy_messages') then
    alter table public.profiles add column privacy_messages text not null default 'all';
  end if;
end $$;

alter table public.profiles drop constraint if exists profiles_privacy_phone_check;
alter table public.profiles add constraint profiles_privacy_phone_check check (privacy_phone in ('all', 'mentoring', 'hide'));
alter table public.profiles drop constraint if exists profiles_privacy_email_check;
alter table public.profiles add constraint profiles_privacy_email_check check (privacy_email in ('all', 'mentoring', 'hide'));
alter table public.profiles drop constraint if exists profiles_privacy_location_check;
alter table public.profiles add constraint profiles_privacy_location_check check (privacy_location in ('all', 'mentoring', 'hide'));
alter table public.profiles drop constraint if exists profiles_privacy_messages_check;
alter table public.profiles add constraint profiles_privacy_messages_check check (privacy_messages in ('all', 'mentoring', 'hide'));

-- Note on scope: privacy_location only gates the contact details shown in
-- the full profile modal (via get_profile_contact below) — it does not
-- hide a member from the existing Directory list/map views, which already
-- show city/country broadly as a directory-browsing feature, not a
-- contact detail. Ask Kyle before extending "hide" to those too.

-- ---------- MENTORING RELATIONSHIP HELPER ----------
-- "Mentoring Relationships" privacy tier = you and the viewer have an
-- active mentor/mentee match (either direction).
create or replace function public.has_mentoring_relationship(a uuid, b uuid)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.mentoring_matches
    where status = 'active'
      and ((mentor_id = a and mentee_id = b) or (mentor_id = b and mentee_id = a))
  );
$$;

-- ---------- PRIVACY-AWARE CONTACT LOOKUP ----------
-- Returns phone/email/location for a profile, each nulled out per that
-- field's privacy setting relative to the viewer (auth.uid()). Always
-- returns real values when viewing your own profile. Runs as security
-- definer so it can read the real email off auth.users (profiles doesn't
-- store a duplicate copy) — ProfileModal calls this instead of selecting
-- these fields directly off `profiles`.
create or replace function public.get_profile_contact(target_id uuid)
returns table (phone text, email text, city text, country text)
language plpgsql security definer set search_path = public
as $$
declare
  v_phone text; v_privacy_phone text;
  v_email text; v_privacy_email text;
  v_city text; v_country text; v_privacy_location text;
  v_is_self boolean;
  v_related boolean;
begin
  v_is_self := (target_id = auth.uid());

  select p.phone, p.privacy_phone, p.city, p.country, p.privacy_location
    into v_phone, v_privacy_phone, v_city, v_country, v_privacy_location
    from public.profiles p where p.id = target_id;

  select u.email, pr.privacy_email into v_email, v_privacy_email
    from auth.users u
    join public.profiles pr on pr.id = u.id
    where u.id = target_id;

  if v_is_self then
    return query select v_phone, v_email, v_city, v_country;
    return;
  end if;

  v_related := public.has_mentoring_relationship(auth.uid(), target_id);

  if v_privacy_phone = 'hide' or (v_privacy_phone = 'mentoring' and not v_related) then v_phone := null; end if;
  if v_privacy_email = 'hide' or (v_privacy_email = 'mentoring' and not v_related) then v_email := null; end if;
  if v_privacy_location = 'hide' or (v_privacy_location = 'mentoring' and not v_related) then v_city := null; v_country := null; end if;

  return query select v_phone, v_email, v_city, v_country;
end;
$$;

revoke all on function public.get_profile_contact(uuid) from public;
grant execute on function public.get_profile_contact(uuid) to authenticated;

-- ---------- MESSAGE PRIVACY ----------
-- Re-defines get_or_create_conversation (originally in schema.sql, the base
-- 1:1 DM feature) to respect the target's privacy_messages setting. Only
-- gates *new*
-- conversations — an existing thread still works even if the other
-- person later tightens this setting, same as most apps' behaviour.
create or replace function public.get_or_create_conversation(other_user uuid)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  conv bigint;
  v_privacy_messages text;
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
    select privacy_messages into v_privacy_messages from public.profiles where id = other_user;
    if v_privacy_messages = 'hide'
       or (v_privacy_messages = 'mentoring' and not public.has_mentoring_relationship(auth.uid(), other_user)) then
      raise exception 'This member is not accepting new messages right now';
    end if;

    insert into public.conversations default values returning id into conv;
    insert into public.conversation_participants (conversation_id, user_id)
    values (conv, auth.uid()), (conv, other_user);
  end if;

  return conv;
end;
$$;

-- ---------- SELF-SERVICE ACCOUNT DELETION ----------
-- Deletes the caller's own auth user; `profiles.id` references
-- `auth.users(id) on delete cascade`, and every table that references
-- `profiles(id)` already does the same (or `on delete set null`), so this
-- one delete cascades through posts/photos/messages/memberships/etc.
create or replace function public.delete_own_account()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

-- ---------- NOTIFICATION PREFERENCES ----------
-- Platform (in-app) notifications only — there's no email-sending service
-- or native mobile app behind this yet, so this table only needs to gate
-- what already exists: the `notifications` table used by NotificationBell.
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  notify_message boolean not null default true,
  notify_post_activity boolean not null default true,   -- likes + comments on your posts, combined
  notify_event_rsvp boolean not null default true,
  notify_event_comment boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;

drop policy if exists "Users can read own notification prefs" on public.notification_preferences;
create policy "Users can read own notification prefs"
  on public.notification_preferences for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can upsert own notification prefs" on public.notification_preferences;
create policy "Users can upsert own notification prefs"
  on public.notification_preferences for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update own notification prefs" on public.notification_preferences;
create policy "Users can update own notification prefs"
  on public.notification_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Re-define the 5 existing notify_* triggers (originally in schema-update-9)
-- to skip the insert when the recipient has turned that category off. A
-- missing preferences row (never visited Settings) defaults to "on" for
-- everything, matching notification_preferences' own column defaults.
create or replace function public.notify_post_like()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_author uuid;
  v_actor_name text;
  v_enabled boolean;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is null or v_author = new.user_id then return new; end if;
  select coalesce((select notify_post_activity from public.notification_preferences where user_id = v_author), true) into v_enabled;
  if not v_enabled then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_author, new.user_id, 'like', 'post', new.post_id,
          coalesce(v_actor_name, 'Someone') || ' liked your post');
  return new;
end;
$$;

create or replace function public.notify_post_comment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_author uuid;
  v_actor_name text;
  v_enabled boolean;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is null or v_author = new.author_id then return new; end if;
  select coalesce((select notify_post_activity from public.notification_preferences where user_id = v_author), true) into v_enabled;
  if not v_enabled then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.author_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_author, new.author_id, 'comment', 'post', new.post_id,
          coalesce(v_actor_name, 'Someone') || ' commented on your post');
  return new;
end;
$$;

create or replace function public.notify_event_rsvp()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid;
  v_title text;
  v_actor_name text;
  v_enabled boolean;
begin
  select created_by, title into v_creator, v_title from public.events where id = new.event_id;
  if v_creator is null or v_creator = new.user_id then return new; end if;
  select coalesce((select notify_event_rsvp from public.notification_preferences where user_id = v_creator), true) into v_enabled;
  if not v_enabled then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_creator, new.user_id, 'event_rsvp', 'event', new.event_id,
          coalesce(v_actor_name, 'Someone') || ' is going to ' || coalesce(v_title, 'your event'));
  return new;
end;
$$;

create or replace function public.notify_event_comment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid;
  v_title text;
  v_actor_name text;
  v_enabled boolean;
begin
  select created_by, title into v_creator, v_title from public.events where id = new.event_id;
  if v_creator is null or v_creator = new.author_id then return new; end if;
  select coalesce((select notify_event_comment from public.notification_preferences where user_id = v_creator), true) into v_enabled;
  if not v_enabled then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.author_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_creator, new.author_id, 'event_comment', 'event', new.event_id,
          coalesce(v_actor_name, 'Someone') || ' commented on ' || coalesce(v_title, 'your event'));
  return new;
end;
$$;

create or replace function public.notify_new_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_recipient uuid;
  v_actor_name text;
  v_enabled boolean;
begin
  select user_id into v_recipient
  from public.conversation_participants
  where conversation_id = new.conversation_id and user_id != new.sender_id
  limit 1;
  if v_recipient is null then return new; end if;
  select coalesce((select notify_message from public.notification_preferences where user_id = v_recipient), true) into v_enabled;
  if not v_enabled then return new; end if;
  select full_name into v_actor_name from public.profiles where id = new.sender_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_recipient, new.sender_id, 'message', 'conversation', new.conversation_id,
          coalesce(v_actor_name, 'Someone') || ' sent you a message');
  return new;
end;
$$;
