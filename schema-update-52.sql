-- schema-update-52.sql — admin activity log
--
-- Why this exists: the site is meant to outlive whoever set it up. When the
-- next committee takes over, "who approved this person?" and "who deleted that
-- post?" should be answerable from inside the app, not from memory.
--
-- Everything here is written by database triggers rather than by the app, so
-- the log can't be skipped by a bug in the front end, an admin using the
-- Supabase dashboard directly, or a future refactor that forgets to call it.
--
-- Safe to re-run.

create table if not exists public.admin_actions (
  id            bigserial primary key,
  actor_id      uuid references auth.users(id) on delete set null,
  actor_name    text,            -- snapshotted: the log must survive the actor being deleted
  action        text not null,   -- approve_member | unapprove_member | grant_admin | revoke_admin
                                 -- delete_member | delete_post | delete_job | delete_event
                                 -- delete_business | feature_business | unfeature_business
                                 -- resolve_report | dismiss_report | reopen_report
  target_type   text,            -- member | post | job | event | business | report
  target_id     text,
  target_label  text,            -- name/title snapshot, same reason as actor_name
  details       text,
  created_at    timestamptz not null default now()
);

create index if not exists admin_actions_created_at_idx on public.admin_actions (created_at desc);
create index if not exists admin_actions_actor_idx      on public.admin_actions (actor_id);

alter table public.admin_actions enable row level security;

-- Admins read. Nobody writes directly — only the security-definer triggers
-- below, which run as the table owner and bypass RLS.
drop policy if exists "admins read activity log" on public.admin_actions;
create policy "admins read activity log" on public.admin_actions
  for select using (public.is_admin());

revoke insert, update, delete on public.admin_actions from authenticated, anon;

/* ---------- shared writer ---------- */

create or replace function public.log_admin_action(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_target_label text,
  p_details text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.admin_actions (actor_id, actor_name, action, target_type, target_id, target_label, details)
  values (auth.uid(), coalesce(v_name, 'an admin'), p_action, p_target_type, p_target_id, p_target_label, p_details);
end;
$$;

-- Not callable from the client: every insert path is a trigger.
--
-- Revoking from `authenticated, anon` alone is a no-op — Postgres grants
-- EXECUTE on new functions to PUBLIC, and those roles inherit it rather than
-- holding their own grant. Without the `public` in this list, any signed-in
-- member could POST to /rest/v1/rpc/log_admin_action and forge entries in the
-- one table whose entire value is being trustworthy.
revoke execute on function public.log_admin_action(text, text, text, text, text) from public, anon, authenticated;

/* ---------- membership changes ---------- */

-- Note on the label: `profiles` has no email column — the Admin page gets
-- addresses by joining auth.users inside the admin_list_members RPC. Reaching
-- for new.email here aborts the whole UPDATE with "record new has no field
-- email", which would break approving members entirely. These functions are
-- SECURITY DEFINER, so they read auth.users directly for the fallback.
create or replace function public.log_profile_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  -- Self-service changes aren't admin actions; neither is the initial insert.
  if new.id = auth.uid() then return new; end if;

  if (new.approved is distinct from old.approved) or (new.is_admin is distinct from old.is_admin) then
    v_label := coalesce(
      nullif(new.full_name, ''),
      (select u.email from auth.users u where u.id = new.id),
      'a member'
    );
  end if;

  if new.approved is distinct from old.approved then
    perform public.log_admin_action(
      case when new.approved then 'approve_member' else 'unapprove_member' end,
      'member', new.id::text, v_label, null
    );
  end if;

  if new.is_admin is distinct from old.is_admin then
    perform public.log_admin_action(
      case when new.is_admin then 'grant_admin' else 'revoke_admin' end,
      'member', new.id::text, v_label, null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_profile_admin_change on public.profiles;
create trigger on_profile_admin_change
  after update of approved, is_admin on public.profiles
  for each row execute function public.log_profile_admin_change();

-- Account removal. Fires for admin-initiated deletes only — someone deleting
-- their own account from Settings is not an admin action.
create or replace function public.log_member_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.id = auth.uid() or auth.uid() is null then return old; end if;
  perform public.log_admin_action('delete_member', 'member', old.id::text,
    coalesce(nullif(old.full_name, ''), (select u.email from auth.users u where u.id = old.id), 'a member'),
    'Account and all their content removed');
  return old;
end;
$$;

drop trigger if exists on_member_deleted on public.profiles;
create trigger on_member_deleted
  before delete on public.profiles
  for each row execute function public.log_member_deletion();

/* ---------- content removed by an admin ---------- */
-- Only logged when the person deleting isn't the owner — members tidying up
-- their own posts is normal housekeeping, not moderation.

create or replace function public.log_post_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or old.author_id = auth.uid() then return old; end if;
  perform public.log_admin_action('delete_post', 'post', old.id::text,
    coalesce(nullif(old.title, ''), 'Untitled post'), null);
  return old;
end; $$;

drop trigger if exists on_post_moderated on public.posts;
create trigger on_post_moderated before delete on public.posts
  for each row execute function public.log_post_moderation();

create or replace function public.log_job_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or old.posted_by = auth.uid() then return old; end if;
  perform public.log_admin_action('delete_job', 'job', old.id::text,
    concat_ws(' — ', old.title, old.company), null);
  return old;
end; $$;

drop trigger if exists on_job_moderated on public.jobs;
create trigger on_job_moderated before delete on public.jobs
  for each row execute function public.log_job_moderation();

create or replace function public.log_event_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or old.created_by = auth.uid() then return old; end if;
  perform public.log_admin_action('delete_event', 'event', old.id::text, old.title, null);
  return old;
end; $$;

drop trigger if exists on_event_moderated on public.events;
create trigger on_event_moderated before delete on public.events
  for each row execute function public.log_event_moderation();

create or replace function public.log_business_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or old.owner_id = auth.uid() then return old; end if;
  perform public.log_admin_action('delete_business', 'business', old.id::text, old.name, null);
  return old;
end; $$;

drop trigger if exists on_business_moderated on public.businesses;
create trigger on_business_moderated before delete on public.businesses
  for each row execute function public.log_business_moderation();

create or replace function public.log_business_promotion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.promoted is distinct from old.promoted then
    perform public.log_admin_action(
      case when new.promoted then 'feature_business' else 'unfeature_business' end,
      'business', new.id::text, new.name, null);
  end if;
  return new;
end; $$;

drop trigger if exists on_business_promoted on public.businesses;
create trigger on_business_promoted after update of promoted on public.businesses
  for each row execute function public.log_business_promotion();

/* ---------- reports ---------- */

create or replace function public.log_report_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform public.log_admin_action(
      case new.status when 'reviewed' then 'resolve_report'
                      when 'dismissed' then 'dismiss_report'
                      else 'reopen_report' end,
      'report', new.id::text,
      concat_ws(' ', 'Report on a', new.entity_type), new.reason);
  end if;
  return new;
end; $$;

drop trigger if exists on_report_decided on public.reports;
create trigger on_report_decided after update of status on public.reports
  for each row execute function public.log_report_decision();

/* ---------- keep the trigger functions off the REST surface ---------- */
-- Same PUBLIC-grant reasoning as above. Calling a trigger function directly
-- errors out ("can only be called as a trigger"), so this isn't exploitable —
-- there's just no reason for them to be reachable over the API at all.
revoke execute on function public.log_profile_admin_change()  from public, anon, authenticated;
revoke execute on function public.log_member_deletion()       from public, anon, authenticated;
revoke execute on function public.log_post_moderation()       from public, anon, authenticated;
revoke execute on function public.log_job_moderation()        from public, anon, authenticated;
revoke execute on function public.log_event_moderation()      from public, anon, authenticated;
revoke execute on function public.log_business_moderation()   from public, anon, authenticated;
revoke execute on function public.log_business_promotion()    from public, anon, authenticated;
revoke execute on function public.log_report_decision()       from public, anon, authenticated;
