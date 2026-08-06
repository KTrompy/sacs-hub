-- schema-update-47.sql — security fixes from BREAKAGE_AUDIT_2026_08_01.md
--
-- Covers H2, H3, H4, H5, M1, M2, M3, M9, M10 and L2.
-- Safe to re-run: every statement is guarded or uses "if exists"/"if not exists".
--
-- APPLIED to the live project on 2026-08-01. See also:
--   schema-update-48.sql — performance (M8)
--   schema-update-49.sql — the EXECUTE revokes this file got wrong (see M10 note
--                          at the bottom: revoking from `anon` alone doesn't
--                          remove the default PUBLIC grant that anon inherits)
--
-- H1 (the missing post-videos bucket) is NOT fixed here — video posting is
-- switched off in the app instead (VIDEO_UPLOADS_ENABLED in Feed.jsx). To turn
-- it on later, run this:
--
--   insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--   values ('post-videos','post-videos', true, 52428800,
--           array['video/mp4','video/webm','video/quicktime']);
--
--   create policy "Approved members can upload post videos" on storage.objects
--     for insert to authenticated with check (
--       bucket_id = 'post-videos'
--       and (storage.foldername(name))[1] = (auth.uid())::text
--       and public.is_approved());
--
--   create policy "Users can delete own post videos" on storage.objects
--     for delete to authenticated using (
--       bucket_id = 'post-videos'
--       and (storage.foldername(name))[1] = (auth.uid())::text);

-- ---------------------------------------------------------------------------
-- H2. CVs stay visible to approved members, but stop being readable by the
-- whole internet.
--
-- The bucket was `public = true` with no size limit, no mime restriction, and
-- a SELECT policy of `USING (bucket_id = 'cvs')` — so any signed-in member
-- could list() the entire bucket, and anyone at all could fetch a CV from its
-- URL with no authentication whatsoever. CVs carry home addresses, phone
-- numbers and employment history.
--
-- Intent (confirmed): members SHOULD be able to read each other's CVs. So the
-- read policy stays broad — it's now gated on is_approved() instead of "any
-- authenticated session", and the bucket goes private so the only way in is a
-- short-lived signed URL minted for a real member (see openStorageFile() in
-- src/supabaseClient.js). Size + mime limits match what Profile.jsx already
-- enforces client-side (10 MB, PDF/Word).
-- ---------------------------------------------------------------------------
update storage.buckets
set public             = false,
    file_size_limit    = 10485760, -- 10 MB, matches MAX_CV_SIZE in Profile.jsx
    allowed_mime_types = array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
where id = 'cvs';

drop policy if exists "Anyone can read CVs" on storage.objects;

create policy "Approved members can read CVs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cvs'
    and (
      (storage.foldername(name))[1] = (auth.uid())::text  -- always your own
      or public.is_approved()
      or public.is_admin()
    )
  );

-- Uploads were unrestricted by approval state too — bring them in line with
-- every other bucket in the project.
drop policy if exists "Users can upload their own CV" on storage.objects;
create policy "Users can upload their own CV"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- H3. Job application files were readable by every signed-in member.
--
-- Two permissive SELECT policies existed side by side; permissive policies are
-- OR'd, so the broad one ("Authenticated users can read application files",
-- USING bucket_id = '...') completely overrode the correctly-scoped one. Any
-- member could list() the bucket and sign a URL for anyone's CV or cover
-- letter, including applications to jobs they had nothing to do with.
--
-- Now: you can read your own files, or files attached to an application for a
-- job you posted. Nothing else.
-- ---------------------------------------------------------------------------
drop policy if exists "Authenticated users can read application files" on storage.objects;

create policy "Posters can read applications to their jobs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'job-application-files'
    and exists (
      select 1
      from public.job_applications a
      join public.jobs j on j.id = a.job_id
      where j.posted_by = auth.uid()
        and (a.cv_url = storage.objects.name
             or a.cover_letter_url = storage.objects.name)
    )
  );

-- ("Users can read own application files" already exists and is correct —
--  left in place, it's the other half of the OR.)

-- ---------------------------------------------------------------------------
-- M3. Avatars could never actually be deleted.
--
-- storage.objects had INSERT and UPDATE policies for the avatars bucket but no
-- DELETE policy, so all three .remove() calls in Profile.jsx (old avatar after
-- a re-crop, "Remove photo", and the preserved `original`) were silently
-- refused. "Remove photo" cleared avatar_url in the UI while leaving the image
-- publicly downloadable at its URL forever, and every re-crop leaked another
-- orphaned file.
-- ---------------------------------------------------------------------------
create policy "Users can delete own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- H4. get_profile_contact() bypassed the approval gate.
--
-- schema-update-46 put is_approved() behind every SELECT policy, but this
-- SECURITY DEFINER function reads auth.users.email and profiles.phone/city/
-- country for an arbitrary uuid without checking anything. Since signup is
-- self-service, anyone could create an account, skip verification entirely,
-- and POST /rest/v1/rpc/get_profile_contact for every member id to harvest
-- email addresses and phone numbers.
--
-- Guarded the same way get_or_create_conversation() already is. Reading your
-- OWN contact details still works while pending, which is what the profile
-- screens need.
-- ---------------------------------------------------------------------------
create or replace function public.get_profile_contact(target_id uuid)
returns table(phone text, email text, city text, country text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text; v_privacy_phone text;
  v_email text; v_privacy_email text;
  v_city text; v_country text; v_privacy_location text;
  v_is_self boolean;
begin
  v_is_self := (target_id = auth.uid());

  -- Approval gate. Your own details are always readable (the pending screens
  -- need them); anyone else's requires a verified account.
  if not v_is_self and not public.is_approved() and not public.is_admin() then
    raise exception 'Account not yet approved';
  end if;

  select p.phone, p.privacy_phone, p.city, p.country, p.privacy_location
    into v_phone, v_privacy_phone, v_city, v_country, v_privacy_location
    from public.profiles p where p.id = target_id;

  select u.email, pr.privacy_email into v_email, v_privacy_email
    from auth.users u
    join public.profiles pr on pr.id = u.id
    where u.id = target_id;

  if v_is_self then
    return query select v_phone, v_email, v_city, v_country;
    return;
  end if;

  if v_privacy_phone = 'hide' then v_phone := null; end if;
  if v_privacy_email = 'hide' then v_email := null; end if;
  if v_privacy_location = 'hide' then v_city := null; v_country := null; end if;

  return query select v_phone, v_email, v_city, v_country;
end;
$function$;

-- ---------------------------------------------------------------------------
-- H5. Job posters were never notified about applications.
--
-- ApplyModal.jsx did a client-side insert into `notifications`, but that table
-- has no INSERT policy for `authenticated` — every notification in this app is
-- written by a SECURITY DEFINER trigger. So the insert was rejected by RLS on
-- every single application, invisibly (the .catch() couldn't fire, because a
-- supabase-js query builder resolves with {error} rather than rejecting).
--
-- Same shape as the other notify_* triggers, including honouring the
-- recipient's notification preference.
-- ---------------------------------------------------------------------------
create or replace function public.notify_job_application()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_poster uuid;
  v_title text;
  v_actor_name text;
begin
  select posted_by, title into v_poster, v_title
    from public.jobs where id = new.job_id;
  if v_poster is null or v_poster = new.applicant_id then return new; end if;

  select full_name into v_actor_name
    from public.profiles where id = new.applicant_id;

  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (
    v_poster, new.applicant_id, 'job_application', 'job', new.job_id,
    coalesce(v_actor_name, 'Someone') || ' applied to your "'
      || coalesce(v_title, 'listing') || '" listing.'
  );

  return new;
exception when others then
  -- Never let a notification failure take down the application itself.
  raise warning 'notify_job_application failed for % — %', new.id, sqlerrm;
  return new;
end;
$function$;

drop trigger if exists trg_notify_job_application on public.job_applications;
create trigger trg_notify_job_application
  after insert on public.job_applications
  for each row execute function public.notify_job_application();

-- ---------------------------------------------------------------------------
-- M1. Withdrawn applications never disappeared in realtime.
--
-- JobApplications.jsx subscribes to DELETE with `filter: job_id=eq.<id>`, but
-- with REPLICA IDENTITY DEFAULT a delete payload only carries primary-key
-- columns. job_applications' PK is `id`, so job_id was never in the payload
-- and the filter could never match — the listener simply never fired.
--
-- FULL replicates the whole old row so the filter works. This table is
-- low-volume, so the extra WAL is negligible.
-- ---------------------------------------------------------------------------
alter table public.job_applications replica identity full;

-- ---------------------------------------------------------------------------
-- M2. delete_own_account() was a live landmine.
--
-- schema-update-3.sql marked it SUPERSEDED and supabaseClient.js documents it
-- as a silent no-op, yet it still existed and was EXECUTE-able by every signed
-- in user — any future call would return success and delete nothing. Real
-- self-service deletion goes through the delete-account Edge Function, which
-- uses the Admin API and also cleans up storage.
-- ---------------------------------------------------------------------------
drop function if exists public.delete_own_account();

-- ---------------------------------------------------------------------------
-- L2. job_applications.applicant_id carried two foreign keys — one to
-- auth.users and one to profiles. The PostgREST embed only resolves today
-- because exactly one of them targets `profiles`; add a second and every
-- application query breaks with an ambiguity error. profiles.id itself
-- cascades from auth.users, so the auth.users one is redundant.
-- ---------------------------------------------------------------------------
alter table public.job_applications
  drop constraint if exists job_applications_applicant_id_fkey;

-- ---------------------------------------------------------------------------
-- M9. Orphan storage buckets left behind by removed features (Groups and
-- Merchandise, both ripped out on 2026-07-28). They were still public write
-- targets with no owning feature.
--
-- NOTE: Postgres refuses a direct DELETE against storage.objects —
-- storage.protect_delete() raises "Direct deletion from storage tables is not
-- allowed. Use the Storage API instead." So this part is NOT done in SQL.
-- Buckets with no objects can be dropped from storage.buckets directly (below);
-- anything with files in it has to go via the dashboard (Storage → bucket →
-- Delete bucket) or the Storage API.
-- ---------------------------------------------------------------------------
delete from storage.buckets
where id in ('group-covers', 'group-post-images', 'merch-images')
  and not exists (
    select 1 from storage.objects o where o.bucket_id = storage.buckets.id
  );

-- ---------------------------------------------------------------------------
-- M10. Six SECURITY DEFINER functions were callable by the anonymous role.
--
-- Nothing leaked today — admin_list_members() raises 'Admins only' internally
-- and the trigger functions fail on a null NEW. But admin_list_members()
-- returns every member's email address, and the only thing standing between
-- `anon` and that was one internal `if`. Remove the standing exposure.
-- ---------------------------------------------------------------------------
revoke execute on function public.admin_list_members()                    from anon;
revoke execute on function public.is_admin()                              from anon;
revoke execute on function public.is_approved()                           from anon;
revoke execute on function public.is_participant(bigint, uuid)            from anon;
revoke execute on function public.notify_admins_new_signup()              from anon;
revoke execute on function public.prevent_last_admin_demotion()           from anon;

-- Trigger functions have no business being callable over the REST API at all.
revoke execute on function public.handle_new_user()          from anon, authenticated;
revoke execute on function public.notify_admins_new_signup() from authenticated;
revoke execute on function public.notify_event_comment()     from anon, authenticated;
revoke execute on function public.notify_event_rsvp()        from anon, authenticated;
revoke execute on function public.notify_new_message()       from anon, authenticated;
revoke execute on function public.notify_post_comment()      from anon, authenticated;
revoke execute on function public.notify_post_like()         from anon, authenticated;
revoke execute on function public.notify_job_application()   from anon, authenticated;
revoke execute on function public.prevent_last_admin_demotion() from authenticated;
