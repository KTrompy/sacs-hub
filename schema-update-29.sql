-- ============================================================
-- Update 29: Scalable "last message per conversation" lookup
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Problem this fixes:
--   Messages.jsx's thread list used to fetch every message across every
--   conversation the user is in (no .limit()), just to pick the single
--   most recent one per conversation client-side. A user with 20
--   conversations of 500 messages each pulled 10,000 rows to render 20
--   preview lines.
--
-- Fix:
--   A DISTINCT ON query, run server-side, that returns exactly one row
--   (the latest) per conversation. Only ever returns conversations the
--   caller actually participates in — enforced with is_participant(),
--   the same helper the RLS policies on messages/conversations use.
-- ============================================================

create or replace function public.last_messages_for_conversations(conv_ids bigint[])
returns table (conversation_id bigint, content text, created_at timestamptz, sender_id uuid)
language sql security definer set search_path = public
as $$
  select distinct on (m.conversation_id)
    m.conversation_id, m.content, m.created_at, m.sender_id
  from public.messages m
  where m.conversation_id = any(conv_ids)
    and public.is_participant(m.conversation_id, auth.uid())
  order by m.conversation_id, m.created_at desc;
$$;

revoke all on function public.last_messages_for_conversations(bigint[]) from public;
grant execute on function public.last_messages_for_conversations(bigint[]) to authenticated;
