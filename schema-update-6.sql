-- ============================================================
-- Update 6: read-tracking for messages (powers the floating
-- inbox's unread badge, LinkedIn-style)
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.conversation_participants
  add column if not exists last_read_at timestamptz not null default now();

-- How many unread messages does the current user have, across every
-- conversation they're part of? Security definer so the client can call it
-- directly without extra RLS plumbing (same pattern as get_or_create_conversation).
create or replace function public.unread_message_count()
returns bigint
language sql security definer set search_path = public
as $$
  select count(*)::bigint
  from public.messages m
  join public.conversation_participants cp
    on cp.conversation_id = m.conversation_id
   and cp.user_id = auth.uid()
  where m.sender_id <> auth.uid()
    and m.created_at > cp.last_read_at;
$$;

-- Called when the current user opens a conversation in the floating inbox,
-- so its messages stop counting toward their unread badge.
create or replace function public.mark_conversation_read(conv_id bigint)
returns void
language sql security definer set search_path = public
as $$
  update public.conversation_participants
  set last_read_at = now()
  where conversation_id = conv_id and user_id = auth.uid();
$$;
