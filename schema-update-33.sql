-- ============================================================
-- Update 33: message editing, deletion, reactions, typing
-- indicators and read receipts for Messages.jsx.
-- Run this in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- Edit / soft-delete ----------
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;

-- Row-level security can restrict *which rows* an UPDATE can touch, but
-- not which columns change within an allowed row — a sender editing their
-- own message could, without more, also rewrite conversation_id or
-- sender_id on it via a raw .update() call. edit_message()/delete_message()
-- below are the only sanctioned way to change an existing message, so the
-- update policy just gates row ownership and the two RPCs gate the rest.
drop policy if exists "Senders can update own messages" on public.messages;
create policy "Senders can update own messages"
  on public.messages for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- Edits a message's content and stamps edited_at — the sender-only check
-- is enforced here (not just the policy above) so a bad client can't also
-- sneak in a change to created_at/conversation_id/sender_id.
create or replace function public.edit_message(msg_id bigint, new_content text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if new_content is null or char_length(trim(new_content)) = 0 or char_length(new_content) > 4000 then
    raise exception 'Message must be between 1 and 4000 characters';
  end if;
  update public.messages
  set content = trim(new_content), edited_at = now()
  where id = msg_id and sender_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'Message not found, not yours, or already deleted';
  end if;
end;
$$;

-- Soft-delete: keeps the row (so "This message was deleted" can render in
-- its place, same pattern WhatsApp/Slack use for thread continuity)
-- rather than removing it outright, which would leave a confusing gap in
-- the other participant's view mid-conversation.
create or replace function public.delete_message(msg_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.messages
  set content = '', deleted_at = now()
  where id = msg_id and sender_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'Message not found, not yours, or already deleted';
  end if;
  delete from public.message_reactions where message_id = msg_id;
end;
$$;

-- ---------- Reactions ----------
create table if not exists public.message_reactions (
  message_id bigint not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.message_reactions enable row level security;

drop policy if exists "Participants can read reactions" on public.message_reactions;
create policy "Participants can read reactions"
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_participant(m.conversation_id, auth.uid())
    )
  );

drop policy if exists "Participants can react" on public.message_reactions;
create policy "Participants can react"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_participant(m.conversation_id, auth.uid()) and m.deleted_at is null
    )
  );

drop policy if exists "Users can remove own reactions" on public.message_reactions;
create policy "Users can remove own reactions"
  on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

-- ---------- Realtime ----------
-- message_reactions needs realtime for live reaction updates. Typing
-- indicators use Supabase Realtime Broadcast instead of a table (nobody
-- needs a durable record that so-and-so was typing a minute ago), so
-- nothing to add there. conversation_participants (last_read_at, from
-- schema-update-6.sql) needs it too — without this, "Seen" only ever
-- updated for the reader themselves on next page load, never live for the
-- person who sent the message.
do $$
begin
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'message_reactions';
  if not found then alter publication supabase_realtime add table public.message_reactions; end if;

  perform 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversation_participants';
  if not found then alter publication supabase_realtime add table public.conversation_participants; end if;
end $$;
