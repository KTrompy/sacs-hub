-- ============================================================
-- Update 66: Admin mass/broadcast email -- opt-out preference.
-- Run this in Supabase SQL Editor. Safe to re-run.
--
-- Context:
--   Admins can now email a filtered/selected group of members at once
--   from Admin -> Members ("Email N selected"), via the new
--   send-broadcast-email Edge Function. That function needs a way to
--   respect a member's wish not to receive these emails.
--
--   notify_admin_broadcast lives on notification_preferences alongside
--   the other notify_* columns, but it is NOT wired into the
--   Email/Mobile/Platform grid in Settings -> Notifications (that grid
--   is specifically for the in-app bell/Platform notification system --
--   see schema-update-9 and NotificationsTab in Settings.jsx). This is
--   the first column on this table that actually gates an email send;
--   it's surfaced as its own toggle ("Committee emails") rather than
--   shoehorned into that grid.
--
--   Defaults to true (opted in), matching every other notify_* column's
--   default and the existing pattern of admin-to-member emails already
--   being on by default with no opt-out at all.
-- ============================================================

alter table public.notification_preferences
  add column if not exists notify_admin_broadcast boolean not null default true;

comment on column public.notification_preferences.notify_admin_broadcast is
  'Opt-out for admin mass/broadcast emails (Admin -> Members -> "Email N selected", sent via send-broadcast-email). Not part of the Email/Mobile/Platform notification grid -- this is a real email opt-out, not a bell-notification preference.';

-- No RLS changes needed: notify_admin_broadcast is a plain column on
-- notification_preferences, covered by that table's existing
-- select/insert/update-own policies. send-broadcast-email reads it with
-- the service-role key, which bypasses RLS entirely, same as every other
-- Edge Function that looks up recipient data.
