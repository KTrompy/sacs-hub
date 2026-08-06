-- schema-update-51.sql
-- Fixes from the 2026-08-01 feature/UI audit (FEATURE_AUDIT_2026_08_01.md).
-- Already applied to the hosted project as migration
-- `schema_update_51_audit_fixes`; kept here so the repo's schema history
-- stays complete.

-- ---------------------------------------------------------------------------
-- 1. Applications to a closed listing
-- ---------------------------------------------------------------------------
-- Jobs.jsx hid the Apply button once isJobClosed() was true, but JobDetail.jsx
-- checked only "not mine" and "not already applied" — so anyone reaching a
-- closed listing directly (saved link, share, bookmark) could still submit,
-- and ApplyModal trusted its caller completely. Both now gate it client-side;
-- this is the check that actually enforces it.
--
-- Africa/Johannesburg rather than UTC deliberately: it mirrors the local-day
-- comparison isJobClosed() makes in the browser, so a listing closing today
-- stays open for the whole SA working day instead of expiring at 02:00.
drop policy if exists "Approved members can apply to jobs" on public.job_applications;
create policy "Approved members can apply to jobs"
  on public.job_applications
  for insert
  to authenticated
  with check (
    applicant_id = (select auth.uid())
    and (select public.is_approved())
    and not exists (
      select 1 from public.jobs j
      where j.id = job_applications.job_id
        and j.closing_date is not null
        and j.closing_date < (now() at time zone 'Africa/Johannesburg')::date
    )
  );

-- ---------------------------------------------------------------------------
-- 2. is_participant() answered for anybody
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER bypasses RLS inside the function body, and this one took
-- the user id as a parameter — so any authenticated member could call
-- is_participant(<some conversation>, <someone else's uuid>) and get a
-- straight yes/no about who is talking to whom. Every caller is an RLS policy
-- passing auth.uid(), so refusing to answer for anyone else changes no
-- behaviour and closes the oracle.
create or replace function public.is_participant(conv_id bigint, uid uuid)
  returns boolean
  language sql
  security definer
  set search_path to 'public'
as $function$
  select uid = (select auth.uid()) and exists (
    select 1 from public.conversation_participants
    where conversation_id = conv_id and user_id = uid
  );
$function$;

-- ---------------------------------------------------------------------------
-- 3. Duplicate indexes
-- ---------------------------------------------------------------------------
-- Exact duplicates — same table, same column, same method. Both halves of each
-- pair were maintained on every insert/update/delete for no read benefit.
drop index if exists public.businesses_owner_idx;            -- dup of businesses_owner_id_idx
drop index if exists public.conv_participants_user_id_idx;   -- dup of conversation_participants_user_id_idx
