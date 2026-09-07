-- ============================================================
-- Update 64b: Fix over-broad grants from update 64
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- This project's public schema has ALTER DEFAULT PRIVILEGES set up so that
-- every newly created function is automatically granted EXECUTE to anon and
-- authenticated (confirmed via pg_default_acl — not the "PUBLIC" pseudo-role
-- the rest of this codebase's REVOKE ALL ... FROM PUBLIC comments assume).
-- Update 64's grants section only revoked from `public`, which is a no-op
-- against a direct per-role default grant, so every new/changed mentoring
-- RPC was left callable by anon. This revokes from anon and authenticated
-- explicitly and re-grants only what each function actually needs.
-- ============================================================

revoke execute on function public.request_mentorship(uuid, boolean, text, text[], text, smallint, text) from anon, authenticated;
revoke execute on function public.respond_to_mentorship(bigint, text, text, text, text, text[], text, boolean) from anon, authenticated;
revoke execute on function public.respond_to_mentorship_terms(bigint, text) from anon, authenticated;
revoke execute on function public.cancel_mentorship_request(bigint) from anon, authenticated;
revoke execute on function public.wrap_up_mentorship(bigint, text, text) from anon, authenticated;
revoke execute on function public.submit_mentorship_checkin(bigint, text) from anon, authenticated;
revoke execute on function public.send_mentoring_connection(uuid, text, text, smallint) from anon, authenticated;
revoke execute on function public.respond_mentoring_connection(bigint, text, text, timestamptz) from anon, authenticated;
revoke execute on function public.mentoring_admin_stats() from anon, authenticated;

-- Pure trigger/internal helpers — never meant to be called directly at all.
-- These also still carry Postgres's own default PUBLIC-execute grant (separate
-- from the anon/authenticated default-ACL grant above), so `public` has to be
-- revoked too or has_function_privilege(anon, ...) keeps returning true.
revoke all on function public.touch_mentorship_after_session() from public, anon, authenticated;
revoke all on function public.notify_mentoring_connection_request() from public, anon, authenticated;
revoke all on function public.notify_mentoring_connection_response() from public, anon, authenticated;
revoke all on function public.touch_mentoring_profile_updated_at() from public, anon, authenticated;

grant execute on function public.request_mentorship(uuid, boolean, text, text[], text, smallint, text) to authenticated;
grant execute on function public.respond_to_mentorship(bigint, text, text, text, text, text[], text, boolean) to authenticated;
grant execute on function public.respond_to_mentorship_terms(bigint, text) to authenticated;
grant execute on function public.cancel_mentorship_request(bigint) to authenticated;
grant execute on function public.wrap_up_mentorship(bigint, text, text) to authenticated;
grant execute on function public.submit_mentorship_checkin(bigint, text) to authenticated;
grant execute on function public.send_mentoring_connection(uuid, text, text, smallint) to authenticated;
grant execute on function public.respond_mentoring_connection(bigint, text, text, timestamptz) to authenticated;

-- mentoring_admin_stats also gets an explicit in-body admin check (defence
-- in depth, matching how every other admin-only RPC in this codebase works
-- rather than relying on grants alone).
create or replace function public.mentoring_admin_stats()
returns table (
  seeking_guidance_count integer,
  offering_guidance_count integer,
  questions_sent integer,
  questions_answered integer,
  conversations_arranged integer,
  mentorship_requests integer,
  mentorships_accepted integer,
  active_mentorships integer,
  completed_mentorships integer,
  inactive_mentorships integer,
  median_duration_days numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  return query
  select
    (select count(*)::int from public.profiles where seeking_mentor),
    (select count(*)::int from public.profiles where is_open_to_opportunities),
    (select count(*)::int from public.mentorship_connections where kind = 'question'),
    (select count(*)::int from public.mentorship_connections where kind = 'question' and status = 'answered'),
    (select count(*)::int from public.mentorship_connections where kind = 'conversation' and status = 'scheduled'),
    (select count(*)::int from public.mentorships),
    (select count(*)::int from public.mentorships where status in ('active', 'completed', 'ended')),
    (select count(*)::int from public.mentorships where status = 'active'),
    (select count(*)::int from public.mentorships where status = 'completed'),
    (select count(*)::int from public.mentorships
      where status = 'active'
        and coalesce(last_interaction_at, started_at) < now() - interval '45 days'),
    (select percentile_cont(0.5) within group (order by extract(epoch from (coalesce(ended_at, now()) - started_at)) / 86400)
      from public.mentorships where started_at is not null);
end;
$$;

revoke all on function public.mentoring_admin_stats() from public, anon, authenticated;
grant execute on function public.mentoring_admin_stats() to authenticated;
