-- schema-update-50.sql — fixes infinite-recursion bug in profiles UPDATE RLS
-- from schema-update-48.
--
-- APPLIED to the live project on 2026-08-01 (via Supabase MCP, migration
-- fix_profiles_update_rls_recursion).
--
-- schema-update-48's "Users can update own profile" policy pinned
-- approved/is_admin to their current values via a subquery against
-- public.profiles itself:
--
--   approved = (select p.approved from public.profiles p where p.id = auth.uid())
--
-- That subquery is evaluated as the querying role (authenticated), which
-- means it re-enters profiles' own RLS mid-evaluation of the UPDATE's RLS —
-- Postgres refuses this with "42P17: infinite recursion detected in policy
-- for relation \"profiles\"". This wasn't limited to admin actions: it broke
-- EVERY update to the profiles table, because Postgres evaluates all
-- applicable policy expressions (not just the one that ends up mattering)
-- when combining permissive policies. Confirmed broken: Admin.jsx's "Make
-- admin" / "Remove admin" buttons, the last_seen heartbeat in App.jsx
-- (line ~424), and every Settings.jsx save (language, and the generic
-- key/value profile field save) — all were silently 500ing.
--
-- Fix: move the "non-admins can't touch their own approved/is_admin" rule
-- out of RLS (where it required a self-referential subquery) and into a
-- BEFORE UPDATE trigger, which compares OLD/NEW column values directly with
-- no subquery and no RLS re-entry — the same pattern already used by
-- prevent_last_admin_demotion in schema-update-46.

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create or replace function public.prevent_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    if new.approved is distinct from old.approved then
      raise exception 'Only an admin can change approval status.';
    end if;
    if new.is_admin is distinct from old.is_admin then
      raise exception 'Only an admin can change admin status.';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists on_self_privilege_escalation on public.profiles;
create trigger on_self_privilege_escalation
  before update of approved, is_admin on public.profiles
  for each row execute function public.prevent_self_privilege_escalation();

-- Trigger functions don't need EXECUTE granted to anyone (same reasoning as
-- schema-update-49): they run as the trigger owner when the trigger fires,
-- so being callable over /rest/v1/rpc at all is pure surface area.
revoke execute on function public.prevent_self_privilege_escalation() from public, anon, authenticated;
