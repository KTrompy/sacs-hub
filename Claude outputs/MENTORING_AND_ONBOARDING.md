# Mentoring & Onboarding — Full Reference

> Reverse-engineered from the actual code, schema, and RPCs in this repo (not from FEATURES.md's summary — this goes underneath it). Two systems, documented in full: **Onboarding** (the path from "click Sign Up" to "full member with a highlighted profile") and **Mentoring** (the flash-mentoring + structured-mentorship system on `/mentoring`).

---

## Part 1 — Onboarding (Account Lifecycle)

### 1.1 The big picture: 11 gates in App.jsx

Every load of the app runs through a strict ladder of checks, in this exact order, before anyone reaches the real app:

1. **Loading** — session/profile not resolved yet
2. **Recovery mode** — arrived via a password-reset link
3. **No session** — shows `Auth.jsx` (sign in / sign up)
4. **Profile loading** — session exists, profile row still being fetched
5. **Deleted account** — profile has `deleted_at` set
6. **Error** — profile fetch failed (shown instead of silently treating "no row" as "logged in with nothing")
7. **Declined** — `declined_at` is set (admin turned them down)
8. **No consent** — `consented_at` is null → **`FinishSignup.jsx`**
9. **No details** — `details_completed_at` is null → **`CompleteDetails.jsx`**
10. **Not approved** — `approved` is false → **`PendingVerification.jsx`**
11. **Full app**

Two ways in — email/password, or Google OAuth — converge on this same ladder but enter it at different rungs.

### 1.2 Path A — Email signup: the 4-step wizard (`Auth.jsx`)

One `<form>`, four visual steps, all fields kept **mounted** the whole time (`hidden` + inline `display:none`, not conditional rendering) — this is deliberate: browsers and password managers decide whether to offer "save this password?" by inspecting the submitted form, and an earlier version that only rendered step 1's fields while `signupStep === 1` meant the email/password fields were gone from the DOM by the time the form was actually submitted on step 4, so nothing ever prompted to save the new login.

**Step 1 — your details**: first name, last name, preferred first name (optional), email, confirm email, password, confirm password (with a strength meter). Validated by `validateStep1()`: names required, valid email, email must match confirm-email, password must pass `passwordProblem()`, passwords must match.

**Step 2 — your membership record** ("This is what the committee checks you against school records with"): title, date of birth (age must be 5–120 years), cell number, "In SACS from" year and "Class of" year (end ≥ start, and the gap can't exceed `MAX_SCHOOL_YEARS` — a sanity check against picking the wrong decade), industry (with a free-text "Other" fallback), occupation, and at least one **community role** checkbox (Old Boy / current parent / past parent / current staff / past staff). Validated by `validateStep2()`.

**Step 3 — your address** (explicitly labelled optional, with a one-line explanation: *"used to place you on the alumni map and to post you reunion invitations, and it isn't displayed on your profile"*): three address lines, country (autocomplete), province (dropdown if South Africa, free text otherwise), city (autocomplete with live Mapbox geocoding — picking a suggestion captures lat/lng immediately), postcode. Validated by `validateStep3()` (city, country, and province-if-SA required; everything else genuinely optional).

**Step 4 — consent**: "happy to hear news/events by email?" yes/no, a required data-consent checkbox (with a link to the full Privacy Policy modal), phone/SMS contact-preference chips, and a Cloudflare Turnstile challenge slot (currently inert — see §1.7). Validated by `validateStep4()`.

Draft state is written to `localStorage` as the person types (via `readSignupDraft()`/`clearSignupDraft()`), so a refresh or an accidental back-gesture doesn't erase four screens of typing — the password fields are deliberately excluded from what's restored, since the app never persists a password itself.

**On final submit (`handleSignupSubmit`)**: everything from all four steps is bundled into `user_metadata` and sent through `supabase.auth.signUp()`, with `emailRedirectTo` pointed at this deployment's own origin (previously missing, which meant a confirmation link sent from a preview/localhost build fell back to the production Site URL). Two outcomes are handled specially:

- **Anti-enumeration duplicate signup**: when "Confirm email" is on, Supabase deliberately returns a *fake success* for an already-registered address (an obfuscated user with an empty `identities` array) rather than an error, so the signup form can't be used to test which addresses exist. The UI detects this and shows a symmetrically-worded message that neither confirms nor denies the account exists, with a "Go to sign in" fallback.
- **Email confirmation required**: if signup succeeds but no session and no `email_confirmed_at` come back, the screen switches to a "check your inbox" state with a resend-confirmation button (`resendConfirmation()`), rather than treating it as a login failure.

### 1.3 The `handle_new_user()` trigger (schema-update-46)

Fires the instant a row lands in `auth.users`. Two-phase, deliberately:

1. **Minimal insert first** — just `id` and `full_name` (pulled from metadata, falling back to `''`). This step must succeed unconditionally, so a signup can never be lost to a bad value elsewhere.
2. **Guarded bulk update**, wrapped in its own `exception when others` block — writes every wizard field (`start_year`, `grad_year`, address lines, province/city/postcode/country, lat/lng, `email_news_opt_in`) and, critically, stamps **`consented_at = now()`** *only if* `data_consent` was `true` in the metadata (i.e., only for the full email wizard, which sets that flag on step 4). If this block throws, the person still has an account — they just lose the extra details, not the account itself.

`profile_details` (title, DOB, community-role flags, comm preferences) is populated from the same metadata blob, written by the wizard's own follow-up call rather than the trigger.

### 1.4 Path B — Google OAuth signup

A Google sign-in creates the `auth.users` row and the minimal profile via the same trigger, but `data_consent` was never set — so `consented_at` stays null and the person is routed straight to **`FinishSignup.jsx`** on their very next load (rung 8 above).

### 1.5 `FinishSignup.jsx` — the merged Google-joiner screen

Originally split into a "who are you" screen plus a second `CompleteDetails.jsx` screen; that split is gone. Now it's **one screen** covering everything an email joiner filled across steps 1, 2 and 3 at once: first/preferred/last name, title, DOB, cell number, "in SACS from"/"class of" years, address (with the same optional-address explanation), country/province/city, industry/occupation, community roles, the "news by email" choice, phone/SMS preferences, and the data-consent checkbox with the Privacy Policy link.

Name fields are prefilled from whatever Google handed back (`given_name`/`family_name` or a split `full_name`); membership-record fields prefill from any existing `profile_details` row (in case someone half-filled the old profile page before this merge shipped, or reloaded this screen once already). A **draft** is kept in `localStorage` (key includes the user id, 7-day expiry, deliberately excluding the consent checkbox — a tick has to be a live decision, never silently restored) — but only written once the person has actually diverged from what Google supplied, so simply opening the screen doesn't pin Google's first-ever answer over a later corrected one.

On submit: writes `full_name`, `first_name`/`preferred_name`/`last_name`, `start_year`/`grad_year`, address, industry/occupation, and stamps **both** `consented_at` and `details_completed_at` at once (this screen does the work of both CompleteDetails steps). It then fires the `send-member-email` Edge Function (kind: `received`) — fire-and-forget, but the result is still read and logged, since a `.catch()` on `supabase.functions.invoke()` would never fire for network/CORS/"not deployed" failures and would hide all of them.

### 1.6 `CompleteDetails.jsx` — the narrower "step 2" screen

Reached only by someone who *has* `consented_at` but *not* `details_completed_at` — in practice, an email signup whose immediate post-`signUp` detail write failed, or a leftover from the era when this used to be a mandatory second screen for everyone. It asks for exactly the membership-record fields (title, DOB, phone, country/province/city, industry/occupation, community roles, contact channels) and nothing else, then stamps `details_completed_at`.

### 1.7 Known gaps in the onboarding flow

- **Turnstile bot protection is wired up but inert** — the component renders, but `VITE_TURNSTILE_SITE_KEY` isn't configured, so the step-4 challenge and the admin "resend confirmation" challenge never actually run.
- Resend (the email provider) is referenced by several Edge Functions but needs `RESEND_API_KEY` + a verified sending domain to actually send anything.

### 1.8 Waiting to be verified — `PendingVerification.jsx`

Shown once someone is consented + details-complete but not yet `approved`. It's a full-screen gate with:

- A **manual "Check my status" button** that re-queries the profile row (after `await supabase.auth.getSession()`, to dodge a token-not-settled race) and reports one of: still pending, a fetch error, or — if the row is gone entirely — *"it looks like it was removed by an administrator"*, followed by an automatic sign-out 6 seconds later so the person has time to read why.
- A **silent 60-second background poll**, only while the tab is actually visible, that only ever *acts* on success (handing the fresh, now-approved row up to `App.jsx`, which swaps this screen out with no reload) — a failed poll never overwrites the on-screen text with an error the person didn't ask for.
- A **"spotted a mistake?" mailto link** — since the profile editor sits behind the approval gate, this is the only way to correct a misspelt surname or wrong grad year before the committee checks it against school records.

### 1.9 The other side — Admin → Pending (`admin/PendingPage.jsx`)

The review queue an admin (`is_admin = true`) works from, split into four groups that each mean something different:

| Group | Who's in it | What an admin can do |
|---|---|---|
| **Waiting on your decision** | Consented + details-complete + email-confirmed | Approve, or Decline (with an optional reason the person is emailed and shown) |
| **Haven't confirmed their email yet** | Consented but `email_confirmed_at` is null | Nothing to approve yet — resend the confirmation link (Turnstile-gated) |
| **Started but didn't finish signing up** | No `consented_at` at all (Google joiners who closed the tab on FinishSignup) | Nothing to do — they move themselves up the moment they come back |
| **Declined** | `declined_at` set | "Move back to pending" — fully reversible, nothing else is touched |

`notify_admins_new_signup()` (schema-update-46) fires the moment `consented_at` transitions from null to not-null, pushing a notification to every admin — *"X has signed up and is waiting to be verified"* — so the queue doesn't rely on someone remembering to check it. Approving an account is itself locked down at the RLS layer: an admin's update policy requires `consented_at is not null` before `approved` or `is_admin` can be flipped, and a separate trigger prevents the very last admin from demoting themselves and leaving nobody able to approve anyone.

### 1.10 The moment of arrival — first run after approval

Rather than a dedicated onboarding wizard, `App.jsx` runs a one-time effect: the instant a freshly-approved profile loads with `onboarding_complete` still `false`, it flips that flag immediately (so this can only ever fire once) and navigates to `/profile` with `{ highlightMissing: true, focusFirst: true }` in router state. `Profile.jsx` reads that state to visually flag every still-empty field and auto-focus the first one — the "wizard" is really just the ordinary profile editor, primed to show what's missing.

That same highlighting is re-triggerable at any time afterwards:

- **Home dashboard** shows a profile-completion bar.
- **`CompleteProfilePrompt.jsx`** is a once-a-day dismissible modal (gated on a `localStorage` timestamp, not a hard block — Escape/backdrop/"Not now" all close it) listing exactly which of avatar, bio, occupation, company, city, country, grad year, degree, industry, or LinkedIn are still blank, with a "Complete your profile" button that re-fires the same `highlightMissing`/`focusFirst` navigation.

### 1.11 Onboarding-relevant database fields

`profiles`: `consented_at`, `details_completed_at`, `approved`, `onboarding_complete`, `declined_at`, `declined_reason`, `is_admin`, `email_confirmed_at`, `deleted_at`, `first_name`/`preferred_name`/`last_name`/`full_name`, `start_year`, `grad_year`, `phone`, address lines, `province`, `city`, `postal_code`, `country`, `lat`/`lng`, `industry`, `occupation`, `email_news_opt_in`.

`profile_details` (separate table, tighter RLS): `title`, `date_of_birth`, `old_boy`/`current_parent`/`past_parent`/`current_staff`/`past_staff`, `comm_pref_email`/`comm_pref_phone`/`comm_pref_sms`.

---

## Part 2 — Mentoring

### 2.1 Philosophy (from the code's own header comment)

Two paths, on purpose, because they suit different moments:

- **Flash mentoring** — message anyone open to it, one question, no commitment, **no database row at all**. Still the default action on every card, because most useful mentoring is a twenty-minute conversation, and forcing a six-month sign-up first kills that.
- **Structured mentorship** — request → accept → goals → session log → an agreed ending. Opt-in, on top, for pairings that warrant it.

Mentees are also **discoverable**, not just mentors — before this rebuild (schema-update-56), a willing mentor had nowhere to look and nothing to do but wait for someone to find them.

### 2.2 Profile fields that power it

`is_open_to_opportunities` (I'll mentor), `mentor_capacity` (default 2, range 1–20), `mentor_paused` (snooze without wiping your profile), `seeking_mentor` (I want a mentor), `mentee_goals` (text array — what you want help with), `mentee_note` (free-text pitch), `expertise` (what a mentor offers), `availability`, `geographic_focus`, plus general profile fields reused for matching: `industry`, `grad_year`, `city`/`country`, `bio`, `linkedin_url`.

### 2.3 The page — `Mentoring.jsx`

Four tabs, driven by the URL's `?tab=` param (so a link can deep-link into a specific tab):

- **Find a mentor** — always shown
- **Find a mentee** — only if `profile.is_open_to_opportunities` is true (`canMentor`)
- **My mentoring** — badge shows count of incoming pending requests
- **Settings**

`load()` fires three queries in parallel: everyone with `is_open_to_opportunities OR seeking_mentor` (minus yourself), every mentorship you're a party to (either side), and `mentor_load()` (an RPC returning active-mentee counts for every mentor at once, so browse cards don't each need their own query). A `quiet` variant refetches without flipping the page into its full-screen loading state — used after an in-page action so Settings or an expanded workspace isn't unmounted mid-edit.

### 2.4 Browse & the scoring algorithm (`mentorMatch.js`)

Deliberately plain arithmetic, not anything ML-flavoured — it runs entirely on data already in memory, and every point is explainable, because *"Can help with Fundraising and Pricing"* persuades someone to reach out and *"83% match"* does not. **The raw score is never shown to the user** — only up to three human-readable reasons, and a "Strong match" (≥55) / "Good match" (≥30) badge.

Shared signals (`commonSignals`), applied both directions:
- Same industry: **+20**
- Grad-year gap of 5–30 years *in the right direction* (mentor senior to mentee): **+15**, worded as "N years ahead of you" / "N years behind you"; any smaller positive gap: **+8**; wrong direction or missing years: **0**, never negative
- Same city: **+10**; else same country: **+4**

Looking for a mentor (`scoreMentor`): overlap between *your* `mentee_goals` and *their* `expertise` is the dominant signal — **+15 per matching item, capped at 3** (so up to +45), flagged `strong` and rendered as "Can help with X and Y". Then common signals, then availability points (`Available now` +10 / `Part-time available` +7 / `By request/ad-hoc` +4 / `Fully booked` +0, default +3 if unset). Finally, capacity shapes the score rather than filtering people out entirely: a **paused** mentor's score is multiplied by 0.4, a **full** mentor's by 0.5, and a mentor with room gets **+10** (plus a "Not mentoring anyone yet" reason if they have zero active mentees) — the reasoning given is that alumni networks are small enough that hiding people is worse than ordering them badly.

Looking for a mentee (`scoreMentee`): mirrors the above from the other side (overlap between *your* `expertise` and *their* `mentee_goals`), plus a **+8** bonus if the mentee's `mentee_note` is longer than 40 characters — someone who wrote something has already put in more effort than a box-tick.

Results sort by score with a name tiebreak (`byScore`) so identical-scoring people don't visually reshuffle between renders.

**Browse UI**: free-text search (name, occupation, company, industry, expertise/goal tags, bio), an industry filter, a "best match / name A–Z" sort toggle, and (mentor-search only) an "only mentors with a free slot" checkbox. If you're browsing for a mentor and haven't set any `mentee_goals`, a callout explains the list is just alphabetical until you do, with a one-click jump to Settings.

Each **`PersonCard`** shows: avatar, name, role/company line, industry, the match badge, up to three reasons, their bio (or `mentee_note` when browsing mentees), up to four expertise/goal tags, grad year, a capacity pill (open/paused/full), a message button (flash mentoring — opens the shared contact modal pre-filled via `buildIcebreaker()`), a LinkedIn link if one's set, and either the request/offer button or an existing-relationship state ("Request pending" / "Mentoring underway").

### 2.5 `icebreaker.js` — what fills the message box

`buildIcebreaker(me, them)`: *"Hi {firstName}! Saw we're both in {industry} — would love to connect."* when industries match, else a plain *"Hi {firstName}!"* — the point is the message box is never truly blank. `eventIcebreaker()` is a separate, stronger opener used once two people have both RSVP'd "going" to the same event. `matchReason()` is the shorter one-line version used in the "People like you" row elsewhere in the app.

### 2.6 Sending a request — `MentorshipRequestModal.jsx`

Pre-fills up to four "focus" tags from the overlap between your side's goals/expertise and theirs (the reason you clicked in the first place), fully editable via a multi-select autocomplete scoped to the target's industry. Asks for a **cadence** (Weekly / Fortnightly / Monthly [default] / Quarterly / As needed), a **duration** (3 / 6 / 12 months, or Open-ended — default 6), and a **required note** (≤1000 characters — *"a request with no context is easy to say no to"*). A discard-guard confirms before closing if anything's been typed.

Submits via the `request_mentorship` RPC (never a direct table insert). `friendlyError()` translates the RPC's SQLSTATE-tagged exceptions into plain text: `23505` → *"you already have a request or an active mentorship with this member"*, a message containing `AT_CAPACITY` → *"this mentor is already at their limit"*, `54000` → the rate-limit message verbatim, `42501` → a permission message.

### 2.7 The database layer (`schema-update-56.sql`) — every transition is server-side

Deliberate design choice: `mentorships` has a **SELECT policy and nothing else** — no client-side INSERT/UPDATE/DELETE. Every state change is a `SECURITY DEFINER` RPC, because the actual rules (is this person open to this, does a pairing already exist, is there capacity) are painful and fragile to express as row-level-security `WITH CHECK` clauses, and belong next to the data instead.

**`mentorships` table**: `mentor_id`, `mentee_id`, `initiated_by` (which side asked — drives both wording and who may cancel), `status` (`pending` / `active` / `declined` / `cancelled` / `completed` / `ended`), `request_message`, `response_message`, `focus[]` (snapshotted at request time, so a pairing keeps the focus it was agreed on even if the mentee's profile changes later), `cadence`, `duration_months` (1–36), `closing_note`, plus `requested_at`/`responded_at`/`started_at`/`ended_at`/`ended_by`. A **unique partial index** allows only one *live* (pending or active) pairing per pair of people — finished ones don't block a second round later.

**`request_mentorship(p_other, p_as_mentor, p_message, p_focus, p_cadence, p_duration)`**: validates the caller is signed in and approved, the target exists and is approved, and — depending on direction — that the offering side has `is_open_to_opportunities` and the receiving side has `seeking_mentor` (when offering), or that the target is open and not paused (when asking). Checks for an existing live pairing **in either direction** (so if they already asked you, your "request" just answers theirs instead of creating a mirror row) and enforces a soft rate limit of 10 outstanding pending requests you've sent, framed as a nudge against spraying the whole directory rather than a hard security control.

**`respond_to_mentorship(p_id, p_accept, p_message)`**: only the non-initiator may call it, only while `pending`. Capacity is checked **here, at accept time**, not at request time — deliberately, so a full mentor can still see who's interested and choose, they just can't say yes to more than `mentor_capacity` at once (raises `AT_CAPACITY` otherwise).

**`cancel_mentorship_request(p_id)`**: only the original sender, only while pending; sets `cancelled` — and this status deliberately triggers **no notification**, since a withdrawn, never-answered request is best treated as if it never happened.

**`end_mentorship(p_id, p_completed, p_note)`**: either party, only while `active`. `p_completed` distinguishes "we got there" (`completed`) from "this fizzled out" (`ended`) as genuinely different outcomes worth telling apart, rather than lumping a mentor's three finished mentorships in with three abandoned ones.

**`mentor_load()`**: returns `{mentor_id, active_count}` for every mentor with an active pairing, callable by any approved member — this is what lets the browse grid show "N slots open" on every card from one query instead of one round-trip per mentor, without exposing *who* any mentor's mentees actually are.

**Notification triggers** (all wrapped in `exception when others` so a notification failure can never block the underlying action):
- `notify_mentorship_request` (on insert) → *"X offered to mentor you"* / *"X asked you to be their mentor"*
- `notify_mentorship_status` (on status change) → accept/decline/complete/end messages; `cancelled` is silent
- `notify_mentorship_session` (on new session log) → *"X logged a mentoring session"* to the other party

**Superseded system**: an earlier `mentoring_programs` / `mentoring_participants` / `mentoring_matches` / `mentoring_goals` / `mentoring_notes` schema was dropped entirely and replaced by all of the above in this same migration.

### 2.8 "My mentoring" tab

Groups every pairing you're part of into **Needs your answer** (incoming pending), **Active**, **Waiting on them** (outgoing pending), and **Past** (completed/ended/declined/cancelled). Each row (`MentorshipRow`) shows a status pill, "You mentor them"/"They mentor you", cadence + duration, focus tags, and context-appropriate actions: Accept/Decline for an incoming request (with a confirm dialog on decline), Withdraw for an outgoing one, a Message button (still flash mentoring, always available), and — for active/completed/ended pairings — an expandable **workspace**.

Because the browse list only shows people currently opted in, but a mentorship can easily outlive that (someone accepts you, then turns their toggle off *because* they're now busy mentoring you), any counterpart missing from the already-loaded people list is fetched individually by id rather than rendered as a blank card.

### 2.9 Inside an active pairing — `MentorshipWorkspace.jsx`

Loaded lazily, only when a row is expanded (so the list view itself stays a single query regardless of how many pairings someone has). Two halves, justified by one observation: a mentorship rarely dies from a falling-out — it dies because two busy people each assume the other will suggest the next date, and three months pass unnoticed.

**Goals**: add a goal (title ≤200 chars, optional target date), tick it done/open (stamping `completed_at`), delete with confirmation. A progress bar shows the done/total percentage. Editable only while the mentorship is `active` — a closed pairing's goals become a read-only record.

**Sessions**: log a session (date met, minutes 5–600, free-text notes, "what happens before the next one" next-steps, and an optional next-session date) — the form refuses to save if both notes and next-steps are empty, on the theory that an entry with neither isn't worth looking back at. The most recent unresolved "next steps" is surfaced prominently above the log, alongside the next scheduled session date if one's set. Every entry is visible to both sides; only whoever logged a given entry can edit or delete it, and only while the mentorship is still active. If it's been **45+ days** since the last logged session, a note appears to *both* parties — deliberately not singled out to the mentee — so whoever opens the page first can be the one to fix it.

**Ending**: a collapsed "Wrap this up" link expands into an optional closing note and two distinct buttons — **Finished early** vs **Completed** — calling `end_mentorship` with the corresponding flag. The copy explicitly reassures both people that ending keeps the whole record (goals + sessions) readable, and frees up a mentoring slot.

### 2.10 Settings tab

Editable directly on this page (rather than four more links out to the profile editor), on the reasoning that pausing requests or changing capacity are things people decide to do *because* of what they're seeing on the mentoring page itself:

- **Open to mentoring** (Yes / Not right now) — `is_open_to_opportunities`
- **Capacity** — one of 1 / 2 / 3 / 5 / 8, shown alongside "You're currently mentoring N", with a non-blocking warning if you drop capacity below your current active count (nothing is cancelled — you just can't accept anyone new until one wraps up)
- **Pause new requests** (Paused / Open) — `mentor_paused`, stays visible in the directory but blocks new requests
- **Looking for a mentor** (Yes / Not right now) — `seeking_mentor`
- Shortcut links out to Profile for editing expertise/availability or mentee goals

Saves go straight to a `profiles` table update from this component (not routed through the main Profile editor), with a `savingRef` guard so a save-in-flight can't be silently overwritten by a stale `profile` prop re-render landing mid-click.

### 2.11 Where mentoring surfaces elsewhere in the app

The notification bell deep-links any `mentorship`-typed notification straight to the `/mentoring` tab (there's no per-mentorship URL — the pairing lives inside a tab, not at its own route). The "My mentoring" tab badge is the count of pending incoming requests, so an unanswered ask is visible from the tab bar without opening it.
