# SACS Hub — "what could break" audit

**Date:** 1 August 2026
**Scope:** full stack, start to finish — build/config/deploy, auth & access control, database schema + RLS + storage, runtime crash risks, and things that don't add up.
**Method:** read every source file in `src/`, queried the **live** Supabase project (`nshvaejjkknugfuyailz`) for schema, RLS policies, storage buckets, functions, triggers and realtime config, and ran a production build.

Everything below was verified against the live database or the actual file contents — not inferred from the migration files, which have drifted in places.

**Verdict:** the app is in good shape structurally. There's one broken feature, several data-exposure holes in storage, one crash, and a handful of things that silently do nothing. Nothing here will take the whole site down; several things will embarrass you with members' personal documents.

---

## Summary

**Status as of 1 Aug 2026: all items below are fixed except M7 (deferred by you), plus four
things I can't do from here — see [Remaining manual steps](#remaining-manual-steps).**

| # | Issue | Severity | Status |
|---|---|---|---|
| H1 | `post-videos` bucket doesn't exist — every video post fails | **High** | ✅ Video button hidden behind a flag |
| H2 | Every member can list and download every other member's CV | **High** | ✅ Bucket private + approval-gated + signed URLs |
| H3 | Every member can read every job application's CV + cover letter | **High** | ✅ Scoped to applicant + job poster |
| H4 | `get_profile_contact()` bypasses the approval gate | **High** | ✅ Guarded |
| H5 | Job posters are never notified of applications (insert always denied) | **High** | ✅ Trigger added, client insert removed |
| H6 | Applying for a job without attaching a CV throws a raw JS error | **High** | ✅ Fixed |
| H7 | Account deletion leaves CVs, avatars and business photos publicly online | **High** | ✅ Both delete paths purge all 10 buckets — *needs deploy* |
| H8 | Account deletion will break the day you move to a custom domain | **High** | ✅ CORS list fixed — *needs deploy* |
| M1 | Withdrawn applications never disappear in realtime | Medium | ✅ `REPLICA IDENTITY FULL` |
| M2 | `delete_own_account()` still exists and is callable; delete mechanism is self-contradictory | Medium | ✅ Dropped; admin path moved off raw SQL |
| M3 | Avatar files are never actually deleted (no DELETE policy) | Medium | ✅ Policy added |
| M4 | Home does a doubled query batch + 600 ms sleep on every single load | Medium | ✅ Better canary |
| M5 | 947 kB single JS bundle, no code splitting | Medium | ✅ 268 → ~152 kB gzip first load |
| M6 | CSP blocks the OpenStreetMap map fallback | Medium | ✅ Fixed |
| M7 | Approval emails still aren't wired up (promised on 3 screens) | Medium | ⏸️ Deferred — you're adding email later |
| M8 | 16 unindexed FKs; 47 RLS policies re-evaluate `auth.uid()` per row | Medium | ✅ 21 indexes + all policies rewritten |
| M9 | Three orphan storage buckets from deleted features | Medium | ⚠️ Made private; deletion needs the dashboard |
| M10 | Six `SECURITY DEFINER` functions are EXECUTE-able by `anon` | Medium | ✅ All 21 locked down |
| M11 | Leaked-password protection is off | Medium | ⚠️ Dashboard toggle |
| M12 | `node_modules/` is committed to git | Medium | ⚠️ `.gitignore` done; untracking needs to run locally |
| L1–L7 | Inconsistencies and cleanup | Low | ✅ All seven |

### Remaining manual steps

Four things need your hands — everything else is already live.

1. **Deploy the Edge Functions** (required for H7/H8):
   ```bash
   supabase functions deploy delete-account
   supabase functions deploy admin-delete-member
   ```
   Until `admin-delete-member` is deployed, Admin → Delete account will fail with a
   404 and change nothing. That's deliberate — see the note in its header about why
   it's a separate function rather than a parameter on `delete-account`.

2. **Delete three orphan buckets** — `group-covers`, `group-post-images`, `merch-images`.
   Postgres blocks direct deletes from `storage.objects` (`storage.protect_delete()`),
   and they still hold 11 leftover files, so this has to go through Storage → select
   bucket → Delete bucket in the dashboard. I've set all three to private in the
   meantime, so nothing in them is publicly reachable.

3. **Turn on leaked-password protection** (M11) — Dashboard → Authentication →
   Providers → Password → "Prevent use of compromised passwords".

4. **Untrack `node_modules`** (M12). `.gitignore` is updated already; the removal
   itself kept timing out against OneDrive from my sandbox, but takes seconds locally:
   ```bash
   git rm -r --cached node_modules dist.old dist.old.2 dist.old.3 dist.old.4 dist-test
   git commit -m "Stop tracking build output and dependencies"
   ```

---

## High

### H1. The `post-videos` bucket doesn't exist — every video post fails

`src/components/Feed.jsx:592-601` uploads to `storage.from('post-videos')`, and `:267` tries to clean up from it on delete. The live project has **12 buckets and `post-videos` is not one of them**.

Anyone who attaches a video and hits Publish gets `Bucket not found` in the composer's error line. The composer has had a working-looking "Add video" button (`Feed.jsx:693`), a preview, and a `posts.video_url` column this whole time.

**Fix (pick one):**
- Create the bucket and mirror the `post-images` policies:
  ```sql
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('post-videos','post-videos', true, 52428800,
          array['video/mp4','video/webm','video/quicktime']);

  create policy "Approved members can upload post videos" on storage.objects
    for insert to authenticated with check (
      bucket_id = 'post-videos'
      and (storage.foldername(name))[1] = auth.uid()::text
      and is_approved());

  create policy "Users can delete own post videos" on storage.objects
    for delete to authenticated using (
      bucket_id = 'post-videos'
      and (storage.foldername(name))[1] = auth.uid()::text);
  ```
- Or hide the video button until you want the feature.

### H2. Every signed-in member can list and download every CV in the system

The `cvs` bucket is:

| property | value |
|---|---|
| `public` | **true** |
| `file_size_limit` | **null** (unlimited) |
| `allowed_mime_types` | **null** (anything) |

and its only read policy is:

```sql
"Anyone can read CVs"  SELECT to authenticated  USING (bucket_id = 'cvs')
```

No owner scoping. Any member can call `storage.from('cvs').list()` and pull down every CV on the site — full name, home address, phone number, employment history, sometimes ID numbers. Supabase's own linter flags this (`public_bucket_allows_listing`). And because the bucket is `public`, the object URLs work with no authentication at all once known.

The unlimited size and unrestricted mime type are a second problem: a member can upload a 2 GB file, or an `.html`/`.svg`, which then sits on your Supabase origin.

**Fix:** make it private, scope reads to the owner, and serve via signed URLs — `JobApplications.jsx:18-34` already has the pattern.

```sql
update storage.buckets set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  where id = 'cvs';

drop policy "Anyone can read CVs" on storage.objects;
create policy "Members can read own CV" on storage.objects
  for select to authenticated using (
    bucket_id = 'cvs' and (storage.foldername(name))[1] = auth.uid()::text);
```

Then change `Profile.jsx:455` / `PersonProfile.jsx:262` / `Profile.jsx:961` to use `createSignedUrl` instead of `getPublicUrl`, and decide deliberately who is allowed to see someone else's CV (probably: nobody, unless they've applied to your job).

### H3. Every signed-in member can read every job application's CV and cover letter

`job-application-files` is correctly private, but it has **two** SELECT policies:

```sql
"Users can read own application files"        USING (bucket_id=... AND folder = auth.uid())   -- correct
"Authenticated users can read application files"  USING (bucket_id = 'job-application-files')  -- wide open
```

Permissive RLS policies are OR'd, so the broad one wins. Any member can `list()` the bucket and `createSignedUrl()` anything in it — including applications to jobs they didn't post.

**Fix:** drop the broad policy and scope it to owner-or-poster.

```sql
drop policy "Authenticated users can read application files" on storage.objects;
create policy "Poster can read applications to their jobs" on storage.objects
  for select to authenticated using (
    bucket_id = 'job-application-files'
    and exists (
      select 1 from public.job_applications a
      join public.jobs j on j.id = a.job_id
      where j.posted_by = auth.uid()
        and (a.cv_url = storage.objects.name or a.cover_letter_url = storage.objects.name)));
```

### H4. `get_profile_contact()` bypasses the approval gate

Migration 46 was specifically about making the approval gate real: every SELECT policy now requires `is_approved()`. But `get_profile_contact(target_id uuid)` is `SECURITY DEFINER`, EXECUTE-able by `authenticated`, and **has no `is_approved()` check**:

```sql
-- reads auth.users.email and profiles.phone/city/country for ANY uuid
select u.email, pr.privacy_email into ... from auth.users u ...
```

Signing up is self-service. Anyone can create an account, skip verification, and hit `POST /rest/v1/rpc/get_profile_contact` with any member's id to get their email address and phone number (whenever the member's privacy setting isn't `'hide'`, which is the default).

`get_or_create_conversation()` already guards itself correctly — copy that.

**Fix:**
```sql
create or replace function public.get_profile_contact(target_id uuid) ... as $$
begin
  if not public.is_approved() and target_id <> auth.uid() then
    raise exception 'Account not yet approved';
  end if;
  ...
```

### H5. Job posters are never notified about applications

`ApplyModal.jsx:118` does a direct client-side insert into `notifications`. The `notifications` table has SELECT and UPDATE policies for `authenticated` but **no INSERT policy** — every other notification in the app is written by a `SECURITY DEFINER` trigger (`notify_new_message`, `notify_post_like`, …). So this insert is rejected by RLS every single time.

It's invisible because of this:

```js
}).catch(() => {})   // non-critical
```

A supabase-js query builder **resolves** with `{ data, error }`; it doesn't reject. `.catch()` never runs, and the `error` is never read. Live DB confirms: `count(*) from notifications where type = 'job_application'` = **0**.

**Fix:** do it the way everything else does — a trigger.

```sql
create or replace function public.notify_job_application() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_poster uuid; v_title text; v_name text;
begin
  select posted_by, title into v_poster, v_title from public.jobs where id = new.job_id;
  if v_poster is null or v_poster = new.applicant_id then return new; end if;
  select full_name into v_name from public.profiles where id = new.applicant_id;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, message)
  values (v_poster, new.applicant_id, 'job_application', 'job', new.job_id,
          coalesce(v_name,'Someone') || ' applied to your "' || coalesce(v_title,'listing') || '" listing.');
  return new;
end; $$;

create trigger trg_notify_job_application after insert on public.job_applications
  for each row execute function public.notify_job_application();
```

Then delete the client-side insert in `ApplyModal.jsx`.

### H6. Applying for a job without attaching a CV crashes

`ApplyModal.jsx` tells the member the uploads are optional:

> "Add a short cover message. **Optionally** upload your CV or cover letter…"

`submit()` only validates the cover message, then unconditionally runs:

```js
const cvPath = await uploadFile(cvFile, 'cv')   // cvFile is null
```

`uploadFile` immediately does `file.name.replace(...)` → `TypeError: Cannot read properties of null (reading 'name')`, which the catch block surfaces to the member verbatim as the form error. Applying without a CV is impossible, and the failure looks like a site bug rather than a missing field.

**Fix:** decide which it is. Either

```js
if (!cvFile) { setError('Please attach your CV.'); return }
```

or

```js
const cvPath = cvFile ? await uploadFile(cvFile, 'cv') : null
// ...
cv_url: cvPath, cv_name: cvFile?.name ?? null,
```

### H7. Deleting an account leaves the person's files online — including their CV

`supabase/functions/delete-account/index.ts` cleans up exactly two things:

```ts
.from('avatars').remove([`${userId}/avatar.jpg`])
.from('post-images').list(userId)  // then remove
```

Two problems:

1. **`avatar.jpg` hasn't been the filename for months.** `Profile.jsx:355` now writes `${userId}/avatar-${Date.now()}.jpg`, plus `${userId}/original`. The remove call targets a path that no longer exists, so it deletes nothing.
2. **Six buckets aren't touched at all:** `cvs`, `business-logos`, `business-covers`, `job-logos`, `job-attachments`, `event-images` (and `post-videos`, once it exists), plus `job-application-files`.

Every one of those except `job-application-files` is **public**. So after a member deletes their account, their CV, headshot, business photos and job attachments stay downloadable at their original URLs, forever — while Settings tells them:

> "Permanently deletes your account, profile, posts, photos, messages and mentoring data. This can't be undone."

That's a POPIA/GDPR erasure problem, not just untidiness.

`admin_delete_member` (used by the Admin → Delete account button) does no storage cleanup whatsoever.

**Fix:** in the Edge Function, loop every bucket and remove the whole `${userId}/` prefix:

```ts
const BUCKETS = ['avatars','post-images','post-videos','cvs','business-logos',
                 'business-covers','job-logos','job-attachments','event-images',
                 'job-application-files']
for (const b of BUCKETS) {
  const { data } = await adminClient.storage.from(b).list(userId)
  if (data?.length) {
    await adminClient.storage.from(b).remove(data.map(f => `${userId}/${f.name}`))
  }
}
```

And route the admin delete through the same Edge Function (with an is_admin check) rather than the raw RPC, so both paths clean up identically.

### H8. Account deletion will break the day you move to a custom domain

The Edge Function's CORS allowlist is:

```ts
const ALLOWED_ORIGINS = [
  'https://sacs-hub.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]
const allowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app')
```

`.env.example` documents the plan to move to `https://sacsalumni.org`. On that domain, `allowed` is false, `Access-Control-Allow-Origin` comes back as the *Vercel* URL, the browser blocks the response, and "Delete account" fails with an opaque network error — the one operation where a silent failure is worst.

Separately, `origin.endsWith('.vercel.app')` allows **any** site hosted on Vercel, which anyone can deploy to for free. No credentials travel by cookie here (the token is an explicit `Authorization` header), so it isn't directly exploitable, but it's a wildcard with no reason to exist.

**Fix:** add the production domain to `ALLOWED_ORIGINS`, drop the `.vercel.app` wildcard (or narrow it to a specific preview prefix), and redeploy: `supabase functions deploy delete-account`.

---

## Medium

### M1. Withdrawn job applications never disappear in realtime

`JobApplications.jsx:66`:

```js
.on('postgres_changes', { event: 'DELETE', table: 'job_applications',
                          filter: `job_id=eq.${jobId}` }, () => load())
```

Every table in this project is `REPLICA IDENTITY DEFAULT`, which means a DELETE payload carries **only primary-key columns**. `job_applications`'s PK is `id` — `job_id` isn't in the payload, so the filter can never match and this listener never fires. A withdrawn application sits on the poster's screen until they reload.

I checked the other DELETE listeners and they're all fine: `posts`/`jobs`/`events` handlers only read `payload.old.id`, and `event_rsvps`/`post_likes`/`message_reactions` have composite PKs that happen to include every column their handlers read.

**Fix:** drop the filter and compare `payload.old.id` against local state, or `alter table public.job_applications replica identity full;`.

### M2. `delete_own_account()` is still live, and the delete mechanism is self-contradictory

`schema-update-3.sql` marks it SUPERSEDED. `supabaseClient.js:16-24` and the Edge Function header both state that a `SECURITY DEFINER` function *cannot* delete from `auth.users` on hosted Supabase — that it silently no-ops. Yet:

- `delete_own_account()` still exists and is EXECUTE-able by `authenticated`. Any future code path that calls it gets a success response and deletes nothing.
- **`admin_delete_member()` (migration 44) is built on exactly the mechanism those comments call broken** — `delete from auth.users where id = target_id`.

I checked the privileges: the owning role (`postgres`) *does* have DELETE on `auth.users`, so `admin_delete_member` probably works fine. But the codebase asserts two incompatible things about the same operation, and the Admin "Delete account" button has never been proven end-to-end.

**Do this before trusting it:** create a throwaway account, delete it from Admin, then confirm `select count(*) from auth.users` actually dropped. Then `drop function public.delete_own_account();` either way.

### M3. Avatar files are never actually deleted

`storage.objects` has INSERT and UPDATE policies for the `avatars` bucket, but **no DELETE policy**. `Profile.jsx` calls `.remove()` in three places — after a re-crop (`:384`), in `deletePhoto` (`:394`), and for the preserved `original` — and all three are silently refused by RLS.

Consequences: "Remove photo" clears `avatar_url` in the UI but the image stays publicly downloadable at its URL indefinitely, and because every save writes a *new* timestamped filename, storage grows without bound for anyone who re-crops.

**Fix:**
```sql
create policy "Users can delete own avatar" on storage.objects
  for delete to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
```

(Note the inconsistency: `cvs` has a delete policy, `avatars` doesn't. Worth auditing all ten buckets for the full insert/update/delete/select set.)

### M4. Home does a doubled query batch + 600 ms sleep on every load

`Home.jsx` guards against the auth-not-settled race with:

```js
if (!isRetry && communityList.length === 0 && businessList.length === 0) {
  await new Promise(r => setTimeout(r, 600))
  await load(true)
}
```

`businesses` currently has **0 rows**. Both fallbacks return empty, so this condition is true on *every* Home load — a 600 ms stall plus a full second round of seven queries, every time, for as long as nobody has listed a business.

**Fix:** key the retry on the `profiles` query alone (there is always at least one other approved member once the site is live), or on a `session`-settled flag rather than on emptiness.

### M5. 947 kB single JS bundle, no code splitting

Production build (verified): `index-*.js` = **947.18 kB / 268.27 kB gzipped**, one chunk. Leaflet, every route, the rich-text editors and the 606-line `constants.js` all load before the first paint. On a mid-range phone over 3G that's several seconds of blank screen, and every deploy invalidates the whole thing.

**Fix:** `React.lazy` the heavy routes (`Admin`, `Events`, `Jobs`, `BusinessDirectory`, `Profile`, `Messages`) behind a `<Suspense>`, and split leaflet out via `build.rollupOptions.output.manualChunks`.

### M6. CSP blocks the OpenStreetMap map fallback

`mapTiles.js` falls back to `https://{s}.tile.openstreetmap.org/...` when `VITE_MAPBOX_TOKEN` isn't set. But `vercel.json`'s CSP allows only:

```
img-src 'self' data: blob: https://*.supabase.co https://api.mapbox.com
```

So if the Mapbox token is ever missing, expired, or over quota in production, the fallback that exists specifically to save you is itself blocked, and every map on the site renders blank with CSP violations in the console.

**Fix:** add `https://*.tile.openstreetmap.org` to `img-src`, or drop the fallback and fail loudly instead.

### M7. Approval emails still aren't wired up

`Admin.jsx:107` — `TODO(approval email)`. Meanwhile the app promises the email on three separate screens:

- `Auth.jsx` signupDone: *"you'll receive an email at **{email}** and can sign in"*
- `PendingVerification.jsx`: *"You'll receive an email at **{email}** as soon as you're confirmed"*
- the auth footer note: *"you'll get an email as soon as you're confirmed"*

Nothing sends it. Approved members only find out by returning and pressing "Check my status" — which most won't. Every approval is currently a dead end from the member's side.

This is the single biggest gap between what the site says and what it does.

### M8. Performance: 16 unindexed FKs, 47 per-row RLS re-evaluations

From Supabase's performance linter against the live project:

- **47 × `auth_rls_initplan`** — every policy calls `is_approved()` / `is_admin()` / `auth.uid()` once *per row* on every SELECT. Wrap them: `USING ((select public.is_approved()) or (select public.is_admin()))` so Postgres evaluates once per query.
- **16 × `unindexed_foreign_keys`** — including `event_comments.author_id`, `post_comments.post_id`, `jobs.posted_by`, `job_applications.applicant_id`. These make member deletion and every "things by this person" lookup a sequential scan.
- **8 × `multiple_permissive_policies`** — e.g. `event_comments` DELETE has both an admin and an author policy; both are evaluated for every row.

Invisible at 4 members. Very visible at 400.

### M9. Three orphan storage buckets from deleted features

`group-covers`, `group-post-images` and `merch-images` all still exist and are `public`, months after Groups and Merchandise were ripped out. They're write targets with no owning feature, and they make future audits harder.

```sql
delete from storage.objects where bucket_id in ('group-covers','group-post-images','merch-images');
delete from storage.buckets  where id       in ('group-covers','group-post-images','merch-images');
```

### M10. Six `SECURITY DEFINER` functions are EXECUTE-able by `anon`

`admin_list_members`, `is_admin`, `is_approved`, `is_participant`, `notify_admins_new_signup`, `prevent_last_admin_demotion` can all be called by unauthenticated clients via `/rest/v1/rpc/…`.

Nothing leaks *today* — `admin_list_members` raises `'Admins only'` internally, and the trigger functions fail on a null `NEW`. But `admin_list_members` returns every member's **email address**, and the only thing standing between `anon` and that is one internal `if`. One refactor that moves the check to the caller turns it into a public member-list endpoint.

```sql
revoke execute on function public.admin_list_members(), public.is_admin(),
  public.is_approved(), public.is_participant(bigint, uuid),
  public.notify_admins_new_signup(), public.prevent_last_admin_demotion() from anon;
```

### M11. Leaked-password protection is off

Supabase Auth can check new passwords against HaveIBeenPwned. It's a single toggle (Dashboard → Authentication → Providers → Password), and right now the app's only password rule is a length minimum.

### M12. `node_modules/` is committed to git

`git ls-files -- node_modules` returns thousands of files. Clones are enormous, `npm ci` fights with what's already tracked, and a stale dependency tree ships with the repo. Also untracked-but-uncleaned: `dist.old`, `dist.old.2/3/4`, `dist-test`, ~200 `vite.config.js.timestamp-*.mjs` files, a 75 MB `supabase.deb`, `lu41irppq.tmp`, `testfile123`, ten `page-NN.jpg`s, a stale `.~lock` file, and a file literally named `earch more broadly`.

```bash
git rm -r --cached node_modules
printf 'dist.old*/\ndist-test/\n*.tmp\n' >> .gitignore
```

(Separately: every commit message in the log is `gf`. Worth breaking the habit — `git log` is the only record of *why* anything changed, and right now it has none.)

---

## Low / cleanup

**L1. Three href sites skip `safeUrl()`.** `Directory.jsx:179` (`p.linkedin_url`), `Mentoring.jsx:182` (same), `JobModal.jsx:115` (`j.apply_url`) and `PersonProfile.jsx:262` (`p.cv_url`) render raw values, while the *same fields* are wrapped in `PersonProfile`, `ProfileModal` and `JobDetail`. `isSafeHttpUrl` blocks bad values at save time so this is defence-in-depth only — but the inconsistency is the bug, since a row inserted directly against the API bypasses save-time validation.

**L2. `job_applications.applicant_id` has two foreign keys** — one to `auth.users`, one to `profiles`. The PostgREST embed (`profiles:applicant_id`) resolves because only one targets `profiles`, but it's latent ambiguity. Drop `job_applications_applicant_id_fkey` (the profiles one already cascades from auth.users transitively).

**L3. Dead render path in Home.** `Home.jsx:~460` renders `p.profiles?.occupation`, but the posts query only selects `full_name, avatar_url`. That line can never display anything.

**L4. `ics.js` folds lines by character count, not octets.** RFC 5545 caps content lines at 75 **octets**; `foldLine` uses JS string length. Afrikaans diacritics are 2 bytes in UTF-8, so a long title or description can overrun, and a fold can land mid-escape-sequence (`\,`). Outlook is the strict one that'll reject it.

**L5. PWA `start_url` is `/directory`** while the app's own default route is `/home` (`App.jsx:` `<Navigate to="/home" replace />`). Installed-app users land somewhere different from browser users, for no stated reason.

**L6. `WhosOnline` conflates two things.** The heading reads *"Who's online · See who's been online recently"* — but the component is pure Supabase presence scoped to whoever currently has the Feed/Home page open, not `last_seen`. Also `const others = members.filter(...)` is computed and never used.

**L7. `Admin.jsx` can approve but never un-approve.** `setApproved` takes a boolean, but `MembersTable` only ever calls it with `true`. If someone is approved by mistake, the only remedy is permanent account deletion. That may be deliberate (Revoke was replaced by Delete in the 1 Aug change) — worth confirming it's what you want.

---

## What I checked and found healthy

Worth recording, so a future audit doesn't re-tread it:

- **RLS coverage is genuinely solid.** All 20 public tables have RLS enabled. Every content table gates SELECT behind `is_approved() or is_admin()`, every INSERT behind `author = auth.uid() and is_approved()`. The `profiles` UPDATE policy correctly prevents self-elevation of `approved` and `is_admin` via a subquery comparison. The admin UPDATE policy correctly requires `consented_at` before approval (migration 45). No table is missing a policy it needs.
- **Foreign keys all cascade correctly** — 24 FKs, all `ON DELETE CASCADE` except `notifications.actor_id` and `reports.reviewed_by`, which are correctly `SET NULL`. No orphan-row risk. `users_without_profile` = 0 in the live DB.
- **The auth flow's gates are real.** `App.jsx`'s `profileStatus` state machine correctly distinguishes "loading" / "loaded but empty" / "error", and the `ProfileLoadError` dead-end closes the old hole where `profile === null` sailed past both approval gates. The auth-not-settled race is handled with `await getSession()` + one retry in both `App.jsx` and `Home.jsx`, and stale-JWT detection forces a real sign-out.
- **XSS surface is properly covered.** All five `dangerouslySetInnerHTML` sites run through DOMPurify (`sanitizeHtml` / `sanitizeBusinessHtml`), sanitising both on save *and* on render. Plain-text extraction uses detached `DOMParser` documents rather than live `innerHTML`. A real CSP is in place in `vercel.json`, along with HSTS, `X-Frame-Options: DENY`, `nosniff` and a `Permissions-Policy`.
- **The production build succeeds.** 179 modules, no errors or type failures. (A local `npm run build` will fail on OneDrive with `EPERM … unlink dist/apple-touch-icon.png` — that's OneDrive locking files, not a code problem. Build to a different `--outDir`, or pause syncing.)
- **`.env` is untracked** and holds only the four public `VITE_*` keys — no service-role key anywhere in the client bundle.
- **Realtime handlers are correct everywhere except M1.** All the DELETE handlers I traced read only primary-key columns from `payload.old`, which is what `REPLICA IDENTITY DEFAULT` actually gives you.
- **Optimistic-update races are handled thoughtfully** — the per-event RSVP serialization in `Events.jsx`, the message dedupe/reconcile in `Messages.jsx`, and the `sessionUserId`-scoped profile effect in `App.jsx` (which stops a token refresh from stomping an in-flight profile save) are all correct and non-obvious.

---

## Suggested order of work

1. **H6** — one-line crash fix, five minutes.
2. **H2, H3, M3, M9** — one SQL migration that fixes the storage policies and buckets together. This is the highest-risk cluster.
3. **H4, M10** — a second small SQL migration for the RPC gate and the `anon` grants.
4. **H1, H5** — restores two features that look like they work and don't.
5. **H7, H8** — one Edge Function redeploy covers both.
6. **M7** — the approval email. It's the biggest promise-vs-reality gap on the site.
7. **M2** — test the admin delete on a throwaway account, then drop `delete_own_account`.
8. **M4, M5, M6, M8, M11, M12** — performance and hygiene, no rush.
9. **L1–L7** — whenever you're next in those files.
