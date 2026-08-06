-- schema-update-49.sql — fixes the EXECUTE revokes that schema-update-47 got wrong.
--
-- APPLIED to the live project on 2026-08-01.
--
-- 47 did `revoke execute ... from anon`, re-ran the Supabase security linter,
-- and the same "Public Can Execute SECURITY DEFINER Function" warnings were
-- still there. The reason: Postgres grants EXECUTE on every new function to
-- PUBLIC by default (it shows up in pg_proc.proacl as a bare `=X/postgres`
-- entry). `anon` inherits that, so revoking from `anon` by name changes
-- nothing at all — you have to revoke from PUBLIC.
--
-- CRITICAL, and the reason this file grants some things straight back:
-- is_admin(), is_approved() and is_participant() MUST keep their EXECUTE grant
-- for `authenticated`. RLS policy expressions are evaluated with the
-- privileges of the querying role, not the policy owner — so revoking these
-- from authenticated would make every policy that calls them fail with
-- "permission denied for function", i.e. take the entire site down. Only the
-- PUBLIC/anon path is being closed.
--
-- Verified afterwards by querying as a real approved member (sees all
-- profiles, badges, own notifications/messages) and as an unapproved one
-- (sees nothing) — no permission errors either way.

revoke execute on function public.is_admin()                    from public;
revoke execute on function public.is_approved()                 from public;
revoke execute on function public.is_participant(bigint, uuid)  from public;
grant  execute on function public.is_admin()                    to authenticated;
grant  execute on function public.is_approved()                 to authenticated;
grant  execute on function public.is_participant(bigint, uuid)  to authenticated;

-- Admin-only and guarded internally, but no reason for it to be reachable
-- without a session — it returns every member's email address.
revoke execute on function public.admin_list_members() from public;
grant  execute on function public.admin_list_members() to authenticated;

-- Trigger functions. These run as the trigger owner when the trigger fires, so
-- nothing needs EXECUTE on them — being callable over /rest/v1/rpc at all was
-- pure surface area.
revoke execute on function public.notify_admins_new_signup()    from public, anon, authenticated;
revoke execute on function public.prevent_last_admin_demotion() from public, anon, authenticated;
revoke execute on function public.notify_job_application()      from public, anon, authenticated;
revoke execute on function public.notify_event_comment()        from public, anon, authenticated;
revoke execute on function public.notify_event_rsvp()           from public, anon, authenticated;
revoke execute on function public.notify_new_message()          from public, anon, authenticated;
revoke execute on function public.notify_post_comment()         from public, anon, authenticated;
revoke execute on function public.notify_post_like()            from public, anon, authenticated;
revoke execute on function public.handle_new_user()             from public, anon, authenticated;

-- Member-facing RPCs: signed-in only, never anonymous.
revoke execute on function public.get_profile_contact(uuid)                  from public;
revoke execute on function public.get_or_create_conversation(uuid)           from public;
revoke execute on function public.unread_message_count()                     from public;
revoke execute on function public.mark_conversation_read(bigint)             from public;
revoke execute on function public.last_messages_for_conversations(bigint[])  from public;
revoke execute on function public.edit_message(bigint, text)                 from public;
revoke execute on function public.delete_message(bigint)                     from public;
revoke execute on function public.admin_delete_member(uuid)                  from public;

grant execute on function public.get_profile_contact(uuid)                  to authenticated;
grant execute on function public.get_or_create_conversation(uuid)           to authenticated;
grant execute on function public.unread_message_count()                     to authenticated;
grant execute on function public.mark_conversation_read(bigint)             to authenticated;
grant execute on function public.last_messages_for_conversations(bigint[])  to authenticated;
grant execute on function public.edit_message(bigint, text)                 to authenticated;
grant execute on function public.delete_message(bigint)                     to authenticated;

-- admin_delete_member() is now DEAD CODE — the Admin screen calls the
-- admin-delete-member Edge Function instead, because this function's raw
-- `delete from auth.users` rests on the exact mechanism the codebase's own
-- comments call unreliable on hosted Supabase, and because it did no storage
-- cleanup (an admin-deleted member left their CV and photos in public buckets).
-- Left in place, but locked to signed-in callers only, so nothing breaks if the
-- Edge Function deploy is delayed. Safe to drop once that's deployed and tested:
--
--   drop function if exists public.admin_delete_member(uuid);
grant execute on function public.admin_delete_member(uuid) to authenticated;
