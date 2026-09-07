# The Onboarding Process — Complete Reference, Start to Finish

Rewritten 7 September 2026 after the unified-onboarding redesign replaced the old 4-step
email wizard + separate Google `FinishSignup.jsx` screen + legacy `CompleteDetails.jsx`
fallback with a single shared 3-step wizard used by both paths. `FinishSignup.jsx` and
`CompleteDetails.jsx` are left on disk, unimported by anything, kept only in case they're
useful to diff against later (same treatment `MerchAdmin.jsx` got in the Admin rebuild) —
they are **not** part of the live flow described below.

Based on a full read of `src/App.jsx`, `src/components/Auth.jsx`,
`src/components/onboarding/*` (`Onboarding.jsx`, `StepAccount.jsx`, `StepAbout.jsx`,
`StepFinish.jsx`, `OnboardingProgress.jsx`, `EmailConfirmation.jsx`, `ApprovalWelcome.jsx`,
`onboardingValidation.js`, `onboardingDraft.js`, `onboardingSubmit.js`),
`src/components/PendingVerification.jsx`, `src/authErrors.js`, `src/authRedirect.js`, the
live Supabase schema/trigger definitions, and the admin-side approval code
(`src/components/admin/PendingPage.jsx`, `src/components/admin/AdminContext.jsx`).

---

## 1. The big picture

Everyone — email/password or Google — goes through the same three steps, in the same
order, asking for the same fields. The only things that differ between the two paths are:
whether Step 1 shows password fields, and how the finished wizard gets saved (a fresh
`supabase.auth.signUp()` call vs. a direct write to an already-authenticated session). That
logic lives in one component, `src/components/onboarding/Onboarding.jsx`, used in two modes:

- **`mode="new"`** — no session yet. Mounted inside `Auth.jsx`'s Join tab. Step 1 has
  password fields. Finishing calls `supabase.auth.signUp()`.
- **`mode="resume"`** — a session already exists but the profile hasn't finished onboarding
  (`!profile.consented_at || !profile.details_completed_at`). Mounted by `App.jsx` as a
  full-screen gate. This is what a Google sign-in hits (no password step, names pre-filled
  from the provider) — and also what a pre-redesign legacy account hits if it consented once
  but never finished its membership record (Onboarding sees `consented_at` set /
  `details_completed_at` unset and resumes at Step 2 instead of asking for a name again,
  replacing what `CompleteDetails.jsx` used to do). Finishing writes directly to `profiles`
  (update) and `profile_details` (upsert).

The ordered gate checklist in `App.jsx` (re-run on every load) is otherwise unchanged from
before the redesign:

1. Still figuring out if there's a session? → "Loading…".
2. Just clicked a password-reset email link? → `ResetPassword.jsx`.
3. No session? → `Auth.jsx` (sign-in / join).
4. Profile still loading? → "Loading…".
5. Account deleted while signed in? → "This account is no longer registered."
6. Profile fetch failed twice? → "We couldn't load your profile," Try again.
7. Declined? → "We couldn't verify your account" (checked before the consent gate — a
   decline applied straight through the database shouldn't require walking through the
   wizard first).
8. `!consented_at || !details_completed_at` → **`<Onboarding mode="resume">`** (this is the
   single gate that replaced the old two separate `FinishSignup`/`CompleteDetails` gates).
9. `!approved` → `PendingVerification.jsx` — full lock, enforced in RLS too.
10. `!onboarding_complete` (first time seeing the app post-approval) → **`ApprovalWelcome.jsx`**
    — new: a one-time "Welcome to the SACS Alumni Hub" screen with **Complete my profile**
    (→ `/profile`, highlight-what's-missing) or **Explore the community** (→ Home). Either
    button flips `onboarding_complete` immediately, same once-only guarantee the old silent
    auto-redirect had — this screen just replaces "silently redirect" with "ask which they'd
    rather do first."
11. All clear → the real app.

---

## 2. Sign-in / Join screen (`Auth.jsx`)

Three modes, same as before: **Sign in**, **Join**, **Forgot password** (link, not a tab).
`Auth.jsx` shrank from ~1470 lines to ~330 — it now only owns sign-in, forgot-password, and
the tab/Google-button chrome around the Join tab. Every field, validator, draft, and submit
concern for signing up lives in `src/components/onboarding/`.

### Sign in
Continue with Google → divider ("or continue with email") → Email → Password → Forgot
password? link → Sign in. CAPTCHA (Turnstile, now the shared `Turnstile.jsx` component
rather than an inline copy) appears if configured. "Email not confirmed" on sign-in shows an
inline **Resend the confirmation email** button (`resendConfirmation()`, shared with the
post-signup confirm screen — see below).

### Forgot password
Email + CAPTCHA + Send reset link, with the same "can't tell an expired reset link from an
expired confirmation link" dual-remedy note and resend button as before. Unchanged.

### Join
Google button + divider shown **only above Step 1** — `Onboarding` reports its current step
up to `Auth.jsx` via `onStepChange`, which hides the Google block once past Step 1 (offering
it again mid-form doesn't make sense, and it was never shown on the confirm-email/pending
screens either). Below that: `<Onboarding mode="new">`.

---

## 3. The 3-step wizard (`src/components/onboarding/`)

**Progress indicator**: "Step X of 3", subtle dots, not the old 4-dot bar (`OnboardingProgress.jsx`).

**Back/Continue**: Back is hidden on whichever step the wizard actually starts on (Step 1
normally; Step 2 for a resuming legacy account) and preserves everything typed — all step
values live in one `values` object in `Onboarding.jsx`'s state, so stepping back and forth
never loses data.

### Step 1 — Create your account (`StepAccount.jsx`)
First name *, Last name *, Preferred first name (optional). `mode="new"` only: Email *,
Confirm email *, Password *, Confirm password * (with the shared password-strength meter).
`mode="resume"`: no password fields; a disabled field shows the account's fixed email
instead; name fields pre-fill from `session.user.user_metadata` (Google's
`given_name`/`family_name`, or a split full name) or, if resuming a legacy account, from the
profile row already on file.

### Step 2 — Tell us about yourself (`StepAbout.jsx`)
Title *, Date of birth *, **Cell number (optional — was required)**, From * / Class of *
(same year-range and gap validation as before, `MAX_SCHOOL_YEARS`), "I'm part of the SACS
community as…" * multi-select chips. **Industry and occupation are gone from signup
entirely** — they're Profile-completion fields now (`Profile.jsx`'s missing-fields system
already had its own required/optional split matching this — degree/industry/job
title/company/city/postal code required there, bio/LinkedIn/phone/business
website/availability/expertise/geographic focus optional — so nothing needed to change on
that side).

### Step 3 — Almost there (`StepFinish.jsx`)
**Location**: Country * (defaults South Africa) / Province * (SA) or free text (elsewhere),
City * (Mapbox autocomplete, captures coordinates), **Address (optional, one line — was
three)**, Postcode (optional, unrestricted format). **Communication**: "Would you like SACS
news and event updates by email?" forced Yes/No, no default (unchanged) — "You may also
contact me via… Phone / SMS" chips, **now default OFF (was default ON)**, per the redesign's
"no accidental opt-in" requirement. **Privacy**: consent checkbox (never pre-checked, never
restored from draft, never inferred from Google), Privacy Policy modal link, CAPTCHA.

### Submitting (`onboardingSubmit.js`)
Both modes build the *same* metadata shape `handle_new_user` already knows how to read (see
`docs/DATABASE.md`) — dropping industry/occupation/address-2/3 from what's collected didn't
require any trigger or schema change, since those columns were already nullable with empty
defaults, and the trigger `coalesce()`s a missing key straight through to the column's
existing value.

- `submitNewAccount()` — `supabase.auth.signUp()` with the bundled metadata, then every edge
  case the old wizard handled: the quiet fake-success duplicate-signup response, an explicit
  "already registered" error, the confirm-email-vs-session-already-there branch, a
  belt-and-braces `profiles`/`profile_details` write once a session exists, and the
  fire-and-forget "received" email.
- `submitResume()` — direct `profiles` update + `profile_details` upsert (the pattern the old
  `FinishSignup.jsx` used), for an already-authenticated session.
- `resendConfirmation()` — shared by `Auth.jsx`'s sign-in-form resend and
  `EmailConfirmation.jsx`.

### Draft persistence (`onboardingDraft.js`)
Same 7-day-expiry, never-passwords, never-consent rules as before, just parametrised by key
so one implementation covers both `mode="new"`'s shared `sacs-signup-draft` key and
`mode="resume"`'s per-user `sacs-onboarding-draft-<uid>` key. Restore banner copy simplified
to "We've restored the details you previously entered" + Start fresh, per the redesign brief
(no explanation of local storage).

### Check your email (`EmailConfirmation.jsx`)
Shown when `mode="new"`'s signUp leaves no session (email confirmation required). Same
content as the old inline screen: confirmation address, spam-folder reminder, its own
CAPTCHA + resend button.

---

## 4. Pending verification (`PendingVerification.jsx`)

Unchanged mechanically — manual "Check my status," a 60-second background poll while the tab
is visible, the removed-while-pending and error states, "Get in touch," Sign out. Only the
copy changed: title is now "You're all set[, name]" and the body is split into "We've
received your details and they're being checked against SACS school records" / "We'll email
you… as soon as your account has been verified," per the redesign brief.

---

## 5. Approval welcome (`ApprovalWelcome.jsx`)

New. See gate #10 above. Not part of onboarding conceptually — the user is already a member
the moment this shows; it's a one-time welcome moment before handing them to the real,
permanent Profile page (never another wizard).

---

## 6. Admin side — unchanged

`admin/PendingPage.jsx`'s four groups (ready / unconfirmed / unfinished / declined) bucket
purely on `consented_at` and `email_confirmed_at`, which the new flow still sets at exactly
the same moment as before — so nothing there needed to change, including the "unfinished"
group's explanatory note (still accurate: only a Google sign-in can produce a session +
profile row before the wizard is submitted, since an email/password account doesn't exist at
all until `signUp()` fires at the very end of Step 3). Approve/decline/undo/resend/nudge, the
`admin_list_members()` RPC, and the RLS/`is_approved()`/`is_admin()` security boundary are all
untouched.

---

## 7. Technical file map

| Stage | File |
|---|---|
| Top-level gate logic | `src/App.jsx` |
| Sign in / Join tabs / Forgot password | `src/components/Auth.jsx` |
| Onboarding orchestrator (both modes) | `src/components/onboarding/Onboarding.jsx` |
| Step 1 / 2 / 3 | `src/components/onboarding/StepAccount.jsx` / `StepAbout.jsx` / `StepFinish.jsx` |
| Progress indicator | `src/components/onboarding/OnboardingProgress.jsx` |
| Check-your-email screen | `src/components/onboarding/EmailConfirmation.jsx` |
| Post-approval welcome | `src/components/onboarding/ApprovalWelcome.jsx` |
| Shared validators | `src/components/onboarding/onboardingValidation.js` |
| Shared draft persistence | `src/components/onboarding/onboardingDraft.js` |
| Both submit strategies + resend | `src/components/onboarding/onboardingSubmit.js` |
| "Thanks for joining!" pending-approval lock screen | `src/components/PendingVerification.jsx` |
| Password-reset landing screen | `src/components/ResetPassword.jsx` |
| Plain-English error message translations | `src/authErrors.js` |
| Correct-environment redirect URL builder | `src/authRedirect.js` |
| Standalone CAPTCHA widget | `src/components/Turnstile.jsx` |
| Admin's Pending-approval queue | `src/components/admin/PendingPage.jsx` |
| Admin approve/decline/undo/resend logic | `src/components/admin/AdminContext.jsx` |
| Dropdown option lists (titles, provinces, roles) | `src/constants.js` |
| Database trigger that seeds profiles at signup | `handle_new_user` (see `docs/DATABASE.md`) |
| Self-healing function for a missing profile row | `ensure_profile` (see `docs/DATABASE.md`) |
| Not part of the live flow — kept for reference only | `src/components/FinishSignup.jsx`, `src/components/CompleteDetails.jsx` |
