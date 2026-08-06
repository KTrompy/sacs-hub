-- ============================================================
-- Update 30: Missing indexes on hot foreign-key columns
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Problem this fixes:
--   Postgres does not automatically index foreign-key columns. Several of
--   the busiest queries in the app (loading the Feed, opening a
--   conversation, listing which conversations a person is in) filter on
--   columns that have never had an index, so they've been doing a
--   sequential scan of the whole table. Fine at today's row counts;
--   increasingly not as posts/messages accumulate.
--
-- Notes:
--   conversation_participants(conversation_id) doesn't need its own index
--   here — it's already the leading column of the table's composite
--   primary key (conversation_id, user_id), so lookups by conversation_id
--   alone are already indexed. user_id is the *second* column of that key,
--   so "which conversations is this person in" (used to build the
--   Messages.jsx thread list) gets nothing from the existing PK and needs
--   its own index.
-- ============================================================

create index if not exists posts_author_id_idx on public.posts (author_id);
create index if not exists messages_conversation_id_idx on public.messages (conversation_id);
create index if not exists messages_sender_id_idx on public.messages (sender_id);
create index if not exists conversation_participants_user_id_idx on public.conversation_participants (user_id);
