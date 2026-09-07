# The Profile System — Complete Reference

This document covers the SACS Alumni Hub's whole profile system: **View Profile**
(the read-only page anyone sees, including your own) and **Edit Profile** (the
profile-management workspace, yours only). It's based on a full read of the
actual code (`src/components/PersonProfile.jsx`, `src/components/Profile.jsx`,
`src/components/profile/*`, `src/profileCompletion.js`, `src/components/
CompleteProfilePrompt.jsx`, and the relevant bits of `src/components/Home.jsx`
and `src/App.jsx`) as it stands today (7 September 2026, after the View/Edit
split redesign — see `[[profile-redesign]]` in project memory for the design
rationale).

**The one-sentence version**: two pages, one data model. `/people/:personId`
is View Profile — "help me understand this person" — shown for anyone,
including yourself (it recognizes `personId === your own id` and swaps in an
"Edit profile" button + a "Change photo" link instead of Message/Report).
`/profile` is Edit Profile — "help me manage my information" — reached only
from your own View Profile page, or from the Home page's completion CTA / the
once-a-day nudge modal (which both still jump straight into Edit with the
relevant fields highlighted, since that's an explicit "let me fix this now"
action). Editing never happens inline on the public page; viewing your own
profile never shows a form.

---

## 1. Where these pages live and how you get to them

**View Profile** — `/people/:personId`. Four ways in, same as before:
directory cards, Home's "My Community" list and Who's Online, mentoring
links, and anywhere else in the app that links to a person. It's also where
your own header avatar dropdown now points.

**Edit Profile** — `/profile`. Reached from:
1. **Your own View Profile page** — the "Edit profile" button in the hero is
   the primary way in now (see `[[profile-redesign]]` for why this is a
   deliberate extra click versus the old direct-to-edit dropdown link: the
   spec wanted "view yourself as others see you" to be a real, distinct step).
2. **The Home page hero's "Complete your profile" button** — unchanged, still
   jumps straight to Edit with `highlightMissing`/`focusFirst` nav state.
3. **The once-a-day incomplete-profile nudge modal** (`CompleteProfilePrompt.jsx`)
   — same as above.
4. **"Change photo" on your own View Profile page** — jumps to Edit with
   `{ openPhotoModal: true }` nav state, which auto-opens the photo modal on
   arrival (see section 5.1).
5. Directly navigating to `/profile`.

The header avatar dropdown (top-right, every screen size) now reads
**Settings / My profile / Sign out** — "My profile" takes you to your own
View Profile (`/people/<your id>`), not straight to Edit. This was previously
"Edit profile" going directly to `/profile`.

---

## 2. The two database tables behind this system

Unchanged from before the redesign — everything you see is still stored
across two tables, and the split still explains the same things:

- **`profiles`** — the main table (name, bio, career, location, contact,
  expertise, mentoring). Almost every other part of the site reads from
  this. View Profile fetches this row directly (`select('*').eq('id', personId)`)
  for whoever you're looking at; approved users can read any profile row per
  RLS.
- **`profile_details`** — SACS membership-record fields (title, gender, DOB,
  ID number, nationality, home/work phone, association with SACS, comm
  preferences, membership tier), with its own tighter RLS. **Only ever
  fetched by Edit Profile, and only for yourself** — View Profile never
  queries this table, for anyone, including your own profile. This is
  deliberate: membership-record fields are administrative, not part of the
  public profile, and never appear on a profile page at all (see section 5's
  Membership section for where they do live — inside Edit Profile's
  collapsible "SACS membership" accordion, tagged "Administrative").

Practically: a brand-new member has a `profiles` row but might have no
`profile_details` row yet (Edit Profile's SACS membership section just shows
blank fields until the first save creates it). Edit Profile's Save writes to
both tables in one go (section 8, unchanged). The mentoring/opportunity
toggles and photo/CV uploads still save instantly, bypassing "Save changes"
entirely (section 7, unchanged).

**Privacy on View Profile**: for someone else's profile, phone/email/location
are fetched separately through the `get_profile_contact` RPC, which already
respects their Settings → Privacy choices — View Profile never fetches more
than that RPC returns. For your own profile, the privacy RPC is skipped
entirely (there's no reason to privacy-filter your own data from yourself);
phone/city/country come straight off the row, and email comes from
`session.user.email` (profiles doesn't store email as its own column).

---

## 3. Profile completion — now a shared module

The ten-field completion score (`avatar_url`, `bio`, `occupation`, `company`,
`city`, `country`, `grad_year`, `degree`, `industry`, `linkedin_url`) and its
scoring logic used to live only in `Home.jsx`. It's now extracted into
**`src/profileCompletion.js`** (`COMPLETION_FIELDS`, `COMPLETION_FIELD_LABELS`,
`COMPLETION_FIELD_SECTION`, `isFieldFilled`, `completionPercent`,
`missingCompletionFields`) — a pure relocation, the math is unchanged. Both
`Home.jsx` (progress ring, hero CTA, nudge modal) and Edit Profile's new
**Profile completion card** (top of the page, above the section nav — see
section 5.0) import from this single module, so the two surfaces can't drift
out of sync on what counts as "complete" or what a field is called.

The completion card is a straight redesign of the same system: percentage,
a progress bar, "X items remaining," and — new — each missing item is a
clickable chip. Clicking one scrolls Edit Profile to the right section
(`COMPLETION_FIELD_SECTION` maps each of the ten fields to one of the nine
section-nav ids) and focuses the specific field once it's in view.

This ten-field score is still a *separate, smaller* list from Edit Profile's
own broader "still blank" highlighting system (section 4), unchanged.

---

## 4. The "highlight what's missing" system (unchanged logic, new home)

Still triggered by the same two things — first login after approval, and
clicking "Complete your profile" from Home — and still checks the same two
lists (`REQUIRED_FIELD_CHECKS`: degree, industry, occupation, company, city,
postal code, photo; `SKIPPABLE_FIELD_CHECKS`: bio, LinkedIn, phone, business
website, availability, expertise, geographic focus; plus CV separately).
Fields still get the `field-missing` CSS class the moment they're flagged,
and it still clears the instant you interact with the field.

What's new: a `MISSING_FIELD_SECTION` map (parallel to `COMPLETION_FIELD_SECTION`
in section 3, but covering this broader list) drives a small red dot on the
relevant section-nav item, so "something in here still needs attention" is
visible from the nav even before you scroll to it or expand a collapsed
section.

---

## 5. View Profile — section by section (`PersonProfile.jsx`)

Order: **Hero → About → Career → Experience → Documents (CV) → SACS →
Location → Mentoring → Contact & links**. Every section is omitted entirely
(not shown blank) when there's nothing to show — this was already true
before the redesign and remains a hard rule.

**Hero**: large photo, name ("You" tag if it's your own profile), role line
(`occupation @ company`), location line, and a `SACS • Class of <year>` chip
(previously just said "Alumnus"). Actions differ by viewer: someone else's
profile shows Message / LinkedIn / Report icon buttons; your own shows a
single primary **Edit profile** button instead — nothing else, per the
"this should be the primary action, obvious, no menu-hunting" requirement.
Your own photo also gets a small **Change photo** link under it, which
jumps straight to Edit Profile's photo modal (section 4's `openPhotoModal`
nav state) rather than duplicating the whole upload/crop flow on this page.

**About**: the bio, as a plain paragraph.

**Career**: current role — job title, company, industry — as a fact strip.
Separate from the header's role line and from Experience below (Career is
"right now," Experience is history).

**Experience**: unchanged timeline, most recent first, now also renders each
entry's optional description underneath its meta line (previously collected
but not displayed on this page).

**Documents**: CV download, unchanged (signed URL via `openStorageFile`).

**SACS**: years at SACS (`start_year – grad_year`, or whichever half is
present) and degree. Deliberately just those two facts — no membership
fields ever appear here, for anyone, including yourself (see section 2).

**Location**: city and country, as a small fact strip — previously only
shown as a one-line "City, Country" under the hero name; now also has its
own section lower down. Uses the privacy-filtered `get_profile_contact`
result for someone else, or your own row directly for yourself.

**Mentoring**: two visually separate halves so "I can mentor" and "I'm
looking for a mentor" never blur together, each with its own small eyebrow
label (`Can help other alumni`, with a "not currently available" note if
`mentor_paused` is set / `Looking for a mentor`). Same underlying fields as
before (availability, geographic focus, expertise, mentor note, business
website / mentee goals, mentee note); a "View mentor profile" link still
appears for someone else who's an active, non-paused mentor.

**Contact & links**: LinkedIn (as a real "View profile ↗" link), phone,
email — consolidated into one section instead of the old split between a
"Contact" fact strip near the top and a LinkedIn link at the very bottom.
For your own profile this shows your own phone/LinkedIn/email in full (no
privacy filtering needed on your own data).

Bottom of page: a **Send a message** button for someone else's profile;
nothing for your own (Edit profile is already the hero's primary action).

---

## 6. Edit Profile — layout (`Profile.jsx` + `src/components/profile/*`)

**Header**: "← Back to profile" (returns to your own View Profile, not
Home — this changed from the old "← Home" button) / "Edit profile" / "Keep
your alumni profile up to date."

**Completion card** (`ProfileCompletionCard.jsx`): see section 3.

**Section nav** (`ProfileSectionNav.jsx`): nine sections — Overview, About,
Career, Experience, Documents, Location, Contact, Membership, Mentoring.
Desktop: a sticky left sidebar, scroll-spy-highlighted as you scroll (plain
scroll-position check against each section's `getBoundingClientRect()`, no
IntersectionObserver needed for nine sections on one page). Mobile (≤900px):
the same list becomes a horizontally-scrollable sticky pill row under the
masthead instead of a sidebar — same component, same click-to-scroll
behavior, different CSS (`.pe-nav` in styles.css). A small red dot appears
on any nav item covering a still-missing field (section 4).

**Overview section**: the photo (click to open the photo modal — unchanged
upload/crop/delete flow, see section 7 below) plus a live-updating summary
(name, role @ company, city/country, "Class of <year>") built straight from
the in-progress form state, so you get immediate confirmation you're editing
the right profile and see your own edits reflected as you type.

**About / Career / Experience / Documents / Location / Contact**: same
fields and validation as before the redesign (see section 5 of the old doc,
now folded into this one — nothing about *what* these fields do changed,
only their section headings, intro hint copy, and the addition of `id="field-
<key>"` wrappers on the ten completion-tracked fields so the completion
card can jump to them).

**Membership** (`SACS membership`, was "SACS membership details"): same
collapsible accordion, same fields, same `profile_details` table underneath.
Now carries a small "Administrative" tag next to its title and updated hint
copy ("private, and separate from your public profile") to make the
public/private boundary more explicit than before.

**Mentoring**: same collapsible section, same fields and same instant-save
toggles, now with two small eyebrow+description headers inserted above each
half — "Help other alumni / Share your experience with other alumni." above
the mentor fields, "Find a mentor / Let other alumni know you'd like
guidance." above the mentee fields — so the two halves read as two questions
rather than one long list.

**Account**: Sign out / Delete account, moved into their own small section
at the very bottom of the page, deliberately separate from the Save flow —
these are immediate account actions, not draft edits.

---

## 7. What saves instantly vs. what needs "Save changes" (unchanged)

Still exactly the same list as before the redesign:

- "Open to mentoring and other opportunities?" (Yes / Not right now)
- "Are you currently available to mentor?" (Available / Not currently)
- "Looking for a mentor yourself?" (Yes / Not right now)
- Photo upload / replace / delete
- CV upload / replace / remove

Everything else needs Save. What changed is only the chrome around this:

- **No permanently-visible Save button.** A `SaveBar` (`src/components/
  profile/SaveBar.jsx`) mounts only while the form is dirty — a slide-up bar
  fixed to the bottom of the viewport with "You have unsaved changes,"
  **Discard**, and **Save changes**. It disappears the instant you save or
  discard.
- **New: Discard.** Reverts the About/Career/Experience/Location/Contact
  form state back to the last-saved `profiles` row (re-runs the same
  `populateForm()` the page uses on mount), and reverts `profile_details`
  back to a snapshot taken on load/last-save (`savedDetailsRef`). Instant-
  save toggles are obviously unaffected — they're never "dirty" in the first
  place.
- **The "✓ Saved" confirmation** is now a small toast (bottom-right,
  `.pe-saved-toast`) that auto-hides after ~2.6 seconds, instead of a chip
  that sat next to the old always-visible Save button indefinitely.

---

## 8. What happens when you click "Save changes" (unchanged)

Validation → experience cleanup/sort → payload trim/assembly → display-name
rebuild → geocoding-if-needed → `profiles` update → `profile_details` upsert
→ parent notified (`onSaved`) → dirty cleared → toast shown. See the old
doc's section 8 for the exact validation order and geocoding rules — none of
it changed; only the post-save UI (toast instead of a chip, SaveBar
unmounting) is new.

Unsaved-changes protection (App.jsx's "leave without saving?" prompt on
in-app navigation, and the native browser "leave site?" warning on tab
close/refresh) is unchanged and still scoped to `/profile`.

---

## 9. Where this data shows up elsewhere (unchanged)

Home page's completion ring/hero/nudge (now reading `profileCompletion.js`
directly, see section 3), the Mentoring section's Find a Mentor/Find a
Mentee directories, the Alumni Map, and the Old Boys directory & search all
read the same `profiles` columns as before — nothing about what they read
or how changed in this redesign.

---

## 10. Technical file map

| What | File |
|---|---|
| View Profile (self + others) | `src/components/PersonProfile.jsx` |
| Edit Profile | `src/components/Profile.jsx` |
| Edit Profile section nav | `src/components/profile/ProfileSectionNav.jsx` |
| Edit Profile completion card | `src/components/profile/ProfileCompletionCard.jsx` |
| Edit Profile sticky save bar | `src/components/profile/SaveBar.jsx` |
| Shared completion scoring | `src/profileCompletion.js` |
| Once-a-day incomplete-profile nudge | `src/components/CompleteProfilePrompt.jsx` |
| Home page (completion ring, hero, nudge trigger) | `src/components/Home.jsx` |
| Photo cropping tool | `src/components/PhotoCropper.jsx` |
| Dropdown option lists (industries, titles, genders, etc.) | `src/constants.js` |
| Route wiring (`/profile`, `/people/:personId`) | `src/App.jsx` |
| Database tables | `profiles`, `profile_details` (see `docs/DATABASE.md`) |
| New profile-system CSS | `src/styles.css`, appended block headed "PROFILE SYSTEM" |

**Dead code kept for reference, not imported anywhere**: `src/components/
ProfileModal.jsx` — the old floating popup this whole system replaced (first
by `PersonProfile.jsx` as a standalone page, before this redesign; untouched
by this redesign). Same precedent as `MerchAdmin.jsx` and `FinishSignup.jsx`/
`CompleteDetails.jsx` elsewhere in the codebase — left on disk in case it's
useful to diff against, never imported.
