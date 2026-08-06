-- ============================================================
-- Update 42: Fix delete_message() silently failing
-- Run in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- delete_message() (schema-update-33.sql) soft-deletes a message by setting
-- content = '' and deleted_at = now(). But messages_content_check
-- (char_length(content) between 1 and 4000, from schema.sql) rejects empty
-- strings on UPDATE just as it would on INSERT — every delete_message()
-- call was failing with a check-constraint violation, which is why
-- "delete message" appeared to do nothing (the RPC errored, the row never
-- changed, no realtime UPDATE ever fired).
--
-- Relax the constraint to allow empty content only on rows that are
-- already marked deleted, so normal (non-deleted) messages still can't be
-- blank.
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check
  check (deleted_at is not null or char_length(content) between 1 and 4000);
