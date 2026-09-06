-- ============================================================
-- Update 63: Remove the in-app direct-messaging feature
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Context:
--   The floating real-time DM widget (Messages.jsx / FloatingMessages.jsx)
--   has been replaced app-wide by a "contact via email" flow: clicking a
--   "Message" button now opens a compose dialog that sends the recipient a
--   one-off email through Resend (see supabase/functions/send-contact-email),
--   with Reply-To set to the sender's own address. Nothing is stored in the
--   database anymore — no threads, no message history — so the tables,
--   functions, and settings that only existed to support the old in-app
--   inbox are dropped here.
--
-- Safe to run on a database with no real conversation history yet (this
-- project is pre-launch). If this is ever run against a database with real
-- member conversations, back up the `messages` table first — this is not
-- reversible.
-- ============================================================

-- ---------- Stop notifying about messages before dropping anything ----------
-- No FK from notifications to conversations/messages (entity_id is a bare
-- bigint), so these rows would otherwise survive as orphaned, unclickable
-- "message" notifications pointing at a conversation that no longer exists.
delete from public.notifications where type = 'message' or entity_type = 'conversation';

-- ---------- Tables (children before parents) ----------
drop table if exists public.message_reactions cascade;
drop table if exists public.messages cascade;
drop table if exists public.conversation_participants cascade;
drop table if exists public.conversations cascade;

-- ---------- Functions ----------
drop function if exists public.is_participant(bigint, uuid) cascade;
drop function if exists public.get_or_create_conversation(uuid) cascade;
drop function if exists public.mark_conversation_read(bigint) cascade;
drop function if exists public.last_messages_for_conversations(bigint[]) cascade;
drop function if exists public.notify_new_message() cascade;
drop function if exists public.edit_message(bigint, text) cascade;
drop function if exists public.delete_message(bigint) cascade;
drop function if exists public.unread_message_count() cascade;

-- ---------- Columns ----------
-- Drops profiles_privacy_messages_check along with the column.
alter table public.profiles drop column if exists privacy_messages;
alter table public.notification_preferences drop column if exists notify_message;
