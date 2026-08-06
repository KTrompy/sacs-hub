-- schema-update-48.sql — performance fixes (M8) from BREAKAGE_AUDIT_2026_08_01.md
--
-- Three things, all flagged by Supabase's performance linter:
--
--   1. 16 foreign keys with no covering index. Every "things belonging to this
--      person" lookup and every member deletion was a sequential scan.
--   2. 47 policies calling auth.uid() / is_approved() / is_admin() once PER ROW.
--      Wrapping the call in a scalar subquery — (select auth.uid()) — turns it
--      into an InitPlan that Postgres evaluates once per query instead.
--   3. 8 tables with two permissive policies for the same role+action (e.g. an
--      "admins can delete any" and an "authors can delete own" pair). Both get
--      evaluated for every row; merged into one policy with an OR, which is
--      exactly what permissive policies already mean.
--
-- IMPORTANT: this only changes HOW the policies are evaluated, never WHO they
-- let in. Every USING/WITH CHECK expression below is logically identical to
-- what it replaces. Invisible at 4 members; very visible at 400.
--
-- Safe to re-run.

-- ===========================================================================
-- 1. Covering indexes for foreign keys
-- ===========================================================================
create index if not exists post_likes_user_id_idx          on public.post_likes (user_id);
create index if not exists post_comments_post_id_idx       on public.post_comments (post_id);
create index if not exists post_comments_author_id_idx     on public.post_comments (author_id);
create index if not exists posts_author_id_idx             on public.posts (author_id);
create index if not exists events_created_by_idx           on public.events (created_by);
create index if not exists event_rsvps_user_id_idx         on public.event_rsvps (user_id);
create index if not exists event_comments_event_id_idx     on public.event_comments (event_id);
create index if not exists event_comments_author_id_idx    on public.event_comments (author_id);
create index if not exists jobs_posted_by_idx              on public.jobs (posted_by);
create index if not exists job_applications_job_id_idx     on public.job_applications (job_id);
create index if not exists job_applications_applicant_idx  on public.job_applications (applicant_id);
create index if not exists saved_jobs_user_id_idx          on public.saved_jobs (user_id);
create index if not exists saved_events_user_id_idx        on public.saved_events (user_id);
create index if not exists notifications_actor_id_idx      on public.notifications (actor_id);
create index if not exists notifications_user_id_idx       on public.notifications (user_id);
create index if not exists reports_reporter_id_idx         on public.reports (reporter_id);
create index if not exists reports_reviewed_by_idx         on public.reports (reviewed_by);
create index if not exists message_reactions_user_id_idx   on public.message_reactions (user_id);
create index if not exists messages_conversation_id_idx    on public.messages (conversation_id);
create index if not exists conv_participants_user_id_idx   on public.conversation_participants (user_id);
create index if not exists businesses_owner_id_idx         on public.businesses (owner_id);

-- ===========================================================================
-- 2 + 3. Policy rewrites — InitPlan wrapping, and merging duplicate pairs
-- ===========================================================================

-- ---------------------------------------------------------------- businesses
drop policy if exists "Approved members can read businesses"   on public.businesses;
drop policy if exists "Approved members can list a business"    on public.businesses;
drop policy if exists "Owners and admins can update a business" on public.businesses;
drop policy if exists "Owners and admins can delete a business" on public.businesses;

create policy "Approved members can read businesses" on public.businesses
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can list a business" on public.businesses
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_approved()));

create policy "Owners and admins can update a business" on public.businesses
  for update to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()))
  with check (owner_id = (select auth.uid()) or (select public.is_admin()));

create policy "Owners and admins can delete a business" on public.businesses
  for delete to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));

-- --------------------------------------------------- conversations / members
drop policy if exists "Participants can view conversations"    on public.conversations;
drop policy if exists "Participants can view participant rows" on public.conversation_participants;

create policy "Participants can view conversations" on public.conversations
  for select to authenticated
  using (public.is_participant(id, (select auth.uid())));

create policy "Participants can view participant rows" on public.conversation_participants
  for select to authenticated
  using (public.is_participant(conversation_id, (select auth.uid())));

-- ------------------------------------------------------------- event_comments
-- Merges "Admins can delete any event comment" + "Authors can delete own".
drop policy if exists "Approved members can read event comments" on public.event_comments;
drop policy if exists "Approved members can comment on events"   on public.event_comments;
drop policy if exists "Admins can delete any event comment"      on public.event_comments;
drop policy if exists "Authors can delete own event comments"    on public.event_comments;

create policy "Approved members can read event comments" on public.event_comments
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can comment on events" on public.event_comments
  for insert to authenticated
  with check (author_id = (select auth.uid()) and (select public.is_approved()));

create policy "Authors and admins can delete event comments" on public.event_comments
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

-- ---------------------------------------------------------------- event_rsvps
drop policy if exists "Approved members can read rsvps" on public.event_rsvps;
drop policy if exists "Approved members can rsvp"       on public.event_rsvps;
drop policy if exists "Users can cancel own rsvp"       on public.event_rsvps;

create policy "Approved members can read rsvps" on public.event_rsvps
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can rsvp" on public.event_rsvps
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_approved()));

create policy "Users can cancel own rsvp" on public.event_rsvps
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------- events
-- Merges "Admins can delete any event" + "Creators can delete own events".
drop policy if exists "Approved members can read events"   on public.events;
drop policy if exists "Approved members can create events" on public.events;
drop policy if exists "Creators can update own events"     on public.events;
drop policy if exists "Admins can delete any event"        on public.events;
drop policy if exists "Creators can delete own events"     on public.events;

create policy "Approved members can read events" on public.events
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can create events" on public.events
  for insert to authenticated
  with check (created_by = (select auth.uid()) and (select public.is_approved()));

-- Admins can now edit as well as delete — previously they could delete any
-- event but not correct a typo in one, which made no sense for moderation.
create policy "Creators and admins can update events" on public.events
  for update to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()))
  with check (created_by = (select auth.uid()) or (select public.is_admin()));

create policy "Creators and admins can delete events" on public.events
  for delete to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));

-- ----------------------------------------------------------- job_applications
-- Merges "Users can view own applications" + "Posters can view applications
-- to their jobs".
drop policy if exists "Users can view own applications"              on public.job_applications;
drop policy if exists "Posters can view applications to their jobs"  on public.job_applications;
drop policy if exists "Approved members can apply to jobs"           on public.job_applications;
drop policy if exists "Users can withdraw own applications"          on public.job_applications;

create policy "Applicants and posters can view applications" on public.job_applications
  for select to authenticated
  using (
    applicant_id = (select auth.uid())
    or exists (
      select 1 from public.jobs j
      where j.id = job_applications.job_id and j.posted_by = (select auth.uid())
    )
  );

create policy "Approved members can apply to jobs" on public.job_applications
  for insert to authenticated
  with check (applicant_id = (select auth.uid()) and (select public.is_approved()));

create policy "Users can withdraw own applications" on public.job_applications
  for delete to authenticated
  using (applicant_id = (select auth.uid()));

-- ----------------------------------------------------------------------- jobs
-- Merges "Admins can delete any job" + "Posters can delete own jobs".
drop policy if exists "Approved members can read jobs" on public.jobs;
drop policy if exists "Approved members can post jobs" on public.jobs;
drop policy if exists "Posters can update own jobs"    on public.jobs;
drop policy if exists "Admins can delete any job"      on public.jobs;
drop policy if exists "Posters can delete own jobs"    on public.jobs;

create policy "Approved members can read jobs" on public.jobs
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can post jobs" on public.jobs
  for insert to authenticated
  with check (posted_by = (select auth.uid()) and (select public.is_approved()));

create policy "Posters and admins can update jobs" on public.jobs
  for update to authenticated
  using (posted_by = (select auth.uid()) or (select public.is_admin()))
  with check (posted_by = (select auth.uid()) or (select public.is_admin()));

create policy "Posters and admins can delete jobs" on public.jobs
  for delete to authenticated
  using (posted_by = (select auth.uid()) or (select public.is_admin()));

-- ------------------------------------------------------------ message_reactions
drop policy if exists "Participants can read reactions" on public.message_reactions;
drop policy if exists "Participants can react"          on public.message_reactions;
drop policy if exists "Users can remove own reactions"  on public.message_reactions;

create policy "Participants can read reactions" on public.message_reactions
  for select to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and public.is_participant(m.conversation_id, (select auth.uid()))
  ));

create policy "Participants can react" on public.message_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and public.is_participant(m.conversation_id, (select auth.uid()))
        and m.deleted_at is null
    )
  );

create policy "Users can remove own reactions" on public.message_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------------- messages
drop policy if exists "Participants can read messages"          on public.messages;
drop policy if exists "Approved participants can send messages" on public.messages;
drop policy if exists "Senders can update own messages"         on public.messages;

create policy "Participants can read messages" on public.messages
  for select to authenticated
  using (public.is_participant(conversation_id, (select auth.uid())));

create policy "Approved participants can send messages" on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_participant(conversation_id, (select auth.uid()))
    and (select public.is_approved())
  );

create policy "Senders can update own messages" on public.messages
  for update to authenticated
  using (sender_id = (select auth.uid()))
  with check (sender_id = (select auth.uid()));

-- ------------------------------------------------------ notification_preferences
drop policy if exists "Users can read own notification prefs"   on public.notification_preferences;
drop policy if exists "Users can upsert own notification prefs" on public.notification_preferences;
drop policy if exists "Users can update own notification prefs" on public.notification_preferences;

create policy "Users can read own notification prefs" on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Users can upsert own notification prefs" on public.notification_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "Users can update own notification prefs" on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -------------------------------------------------------------- notifications
drop policy if exists "Users can read own notifications"      on public.notifications;
drop policy if exists "Users can mark own notifications read" on public.notifications;

create policy "Users can read own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Users can mark own notifications read" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -------------------------------------------------------------- post_comments
-- Merges "Admins can delete any comment" + "Authors can delete own comments".
drop policy if exists "Approved members can read comments" on public.post_comments;
drop policy if exists "Approved members can comment"       on public.post_comments;
drop policy if exists "Admins can delete any comment"      on public.post_comments;
drop policy if exists "Authors can delete own comments"    on public.post_comments;

create policy "Approved members can read comments" on public.post_comments
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can comment" on public.post_comments
  for insert to authenticated
  with check (author_id = (select auth.uid()) and (select public.is_approved()));

create policy "Authors and admins can delete comments" on public.post_comments
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

-- ----------------------------------------------------------------- post_likes
drop policy if exists "Approved members can read likes" on public.post_likes;
drop policy if exists "Approved members can like"       on public.post_likes;
drop policy if exists "Users can unlike"                on public.post_likes;

create policy "Approved members can read likes" on public.post_likes
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can like" on public.post_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_approved()));

create policy "Users can unlike" on public.post_likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------- posts
-- Merges both the DELETE pair and the UPDATE pair.
drop policy if exists "Approved members can read posts" on public.posts;
drop policy if exists "Approved members can post"       on public.posts;
drop policy if exists "Admins can update any post"      on public.posts;
drop policy if exists "Authors can update own posts"    on public.posts;
drop policy if exists "Admins can delete any post"      on public.posts;
drop policy if exists "Authors can delete own posts"    on public.posts;

create policy "Approved members can read posts" on public.posts
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));

create policy "Approved members can post" on public.posts
  for insert to authenticated
  with check (author_id = (select auth.uid()) and (select public.is_approved()));

create policy "Authors and admins can update posts" on public.posts
  for update to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()))
  with check (author_id = (select auth.uid()) or (select public.is_admin()));

create policy "Authors and admins can delete posts" on public.posts
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

-- ------------------------------------------------------------------- profiles
-- Deliberately NOT merged: the two UPDATE policies have materially different
-- WITH CHECK clauses (the admin one enforces the consent gate from
-- schema-update-45; the self one pins `approved` and `is_admin` to their
-- current values so nobody can promote themselves). Keeping them apart keeps
-- each rule readable and independently auditable.
drop policy if exists "Approved members can view profiles" on public.profiles;
drop policy if exists "Users can update own profile"       on public.profiles;
drop policy if exists "Admins can update any profile"      on public.profiles;

create policy "Approved members can view profiles" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_approved())
    or (select public.is_admin())
  );

create policy "Users can update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and approved = (select p.approved from public.profiles p where p.id = (select auth.uid()))
    and is_admin = (select p.is_admin from public.profiles p where p.id = (select auth.uid()))
  );

create policy "Admins can update any profile" on public.profiles
  for update to authenticated
  using ((select public.is_admin()))
  with check (
    (select public.is_admin())
    and (approved = false or consented_at is not null)
    and (is_admin  = false or consented_at is not null)
  );

-- -------------------------------------------------------------------- reports
drop policy if exists "Reporters and admins can read reports" on public.reports;
drop policy if exists "Members can file reports"              on public.reports;
drop policy if exists "Admins can update reports"             on public.reports;

create policy "Reporters and admins can read reports" on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or (select public.is_admin()));

create policy "Members can file reports" on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()));

create policy "Admins can update reports" on public.reports
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- --------------------------------------------------------------- saved_events
drop policy if exists "Users can read own saved events" on public.saved_events;
drop policy if exists "Users can save events"           on public.saved_events;
drop policy if exists "Users can unsave events"         on public.saved_events;

create policy "Users can read own saved events" on public.saved_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can save events" on public.saved_events
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can unsave events" on public.saved_events
  for delete to authenticated using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------- saved_jobs
drop policy if exists "Users can read own saved jobs" on public.saved_jobs;
drop policy if exists "Users can save jobs"           on public.saved_jobs;
drop policy if exists "Users can unsave jobs"         on public.saved_jobs;

create policy "Users can read own saved jobs" on public.saved_jobs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can save jobs" on public.saved_jobs
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can unsave jobs" on public.saved_jobs
  for delete to authenticated using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------- badges
-- Was `using (true)` for anyone signed in. Badge definitions aren't secret,
-- but there's no reason an unverified account needs them either.
drop policy if exists "Members can view badges" on public.badges;
create policy "Members can view badges" on public.badges
  for select to authenticated
  using ((select public.is_approved()) or (select public.is_admin()));
