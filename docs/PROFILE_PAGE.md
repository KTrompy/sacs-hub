# The "My Profile" (Edit Profile) Page — Complete Reference

This document covers the SACS Alumni Hub's profile-editing screen in full: every field, every button, what each one does, how they connect to each other, what gets saved where, and what other parts of the site read from this page. It's based on a full read of the actual code (`src/components/Profile.jsx`, `src/components/ProfileModal.jsx`, `src/components/CompleteProfilePrompt.jsx`, and the relevant bits of `src/components/Home.jsx`) as it stands today (7 September 2026).

---

## 1. Where this page lives and how you get to it

The page is called **"My profile"** on screen. Its web address is `/profile`. There are four ways into it:

1. **Header avatar dropdown** — click your own avatar photo in the top-right corner of the header on any screen. A small dropdown opens with three options: *Settings*, *Edit profile*, *Sign out*. "Edit profile" takes you here.
2. **The Home page hero** — at the top of Home there's a circular progress ring around your avatar and, next to it, a button. If your profile isn't 100% complete, that button reads **"Complete your profile"** and takes you here (see section 3 for what "complete" means).
3. **The once-a-day nudge pop-up** — if your profile is incomplete, once per calendar day Home shows a modal listing exactly what's missing, with a **"Complete your profile"** button that also lands here.
4. Directly navigating to `/profile` in the browser.

Note that "My profile" is **not** in the main sidebar/tab list (Home, Old Boys, Jobs, Feed, Mentoring, Events, Business Directory, Merch). It deliberately lives only behind your avatar icon, on every screen size, rather than as a regular nav tab.

At the very top of the page itself there's a **"← Home"** back button and the page title "My profile", with the subtitle *"Control how you appear in the directory and what other Old Boys see."*

---

## 2. The two database tables behind this one page

Everything you see on this page is stored across **two separate database tables**, and understanding this split explains a few things about how the page behaves:

- **`profiles`** — the main table. Holds your name, bio, career info, location, contact links, expertise, and mentoring settings. This is the table almost every other part of the site (the directory, the map, search, mentoring) reads from.
- **`profile_details`** — a separate table used only for the "SACS membership details" section (title, gender, date of birth, ID number, nationality, home/work phone, your association with SACS, communication preferences, membership tier). It has **tighter access rules** than `profiles` — the app deliberately keeps sensitive membership-record fields like your ID number out of the same table that things like the public directory query against.

Practically, this means:
- A brand-new member has a `profiles` row (created at signup) but might have **no `profile_details` row at all** yet — the form just shows everything in that section blank until you save it once, at which point the row is created.
- Saving the page writes to **both tables in one go** when you click "Save changes" — see section 8.
- The three mentoring/opportunity toggles (see section 7) and the photo/CV uploads save **immediately on click**, bypassing the "Save changes" button entirely — they write straight to `profiles`, not through the two-table combined save.

---

## 3. The "profile completion" system (Home page + this page, working together)

Before describing the page section by section, it's worth understanding the completion-tracking system that sits above it, because several things on this page only make sense in light of it.

**Home.jsx** scores your profile against exactly ten fields, called `COMPLETION_FIELDS`:

`avatar_url` (photo), `bio`, `occupation`, `company`, `city`, `country`, `grad_year`, `degree`, `industry`, `linkedin_url`.

A field counts as "filled" if it's not null, not undefined, and not just whitespace when trimmed. Your completion percentage is simply `(number filled ÷ 10) × 100`, rounded to the nearest whole number. This percentage drives three things:

1. **The progress ring** around your avatar on Home — an SVG circle whose stroke fills proportionally to your percentage (in the site's orange accent colour), animated with a smooth 0.4-second transition whenever it changes.
2. **The Home hero subtitle and button** — below 100% it reads *"Your profile is X% complete"* with a **"Complete your profile"** button; at 100% it switches to *"Welcome back to the Old Boys network"* with a **"Share something"** button instead (which takes you to the Feed with the post composer already open).
3. **The once-a-day nudge modal** (`CompleteProfilePrompt.jsx`) — if you're below 100%, the first time you load Home on any given calendar day, a pop-up appears listing which of the ten fields are still missing (using friendly labels like "Add a profile photo", "Write a short bio", etc.). You can dismiss it with "Not now", the × button, Escape, or clicking the backdrop — dismissing does **not** touch your actual field values, it just records in your browser's local storage (`profile-nudge-seen:<your-user-id>`, dated) that you've seen today's nudge, so it won't reappear until tomorrow. Clicking **"Complete your profile"** inside the modal navigates you to `/profile` and tells this page to highlight your missing fields (see section 4).

Note that this ten-field completion score is a *separate, smaller* list from the full set of fields the profile page itself flags as "missing" (section 4 covers a longer list, including things like postal code and CV). The Home ring only tracks the ten fields above; the profile page's own highlighting system tracks more.

---

## 4. The "highlight what's missing" system on this page itself

Independently of the Home completion ring, the profile page has its own mechanism for drawing your eye to specific blank fields. It's triggered in exactly two situations:

- **The very first time you land on this page after being approved** by the alumni committee (more on approval in the onboarding document). The app automatically redirects you here the moment your account is approved, with an instruction to highlight anything blank.
- **Clicking "Complete your profile"** from the Home hero button or the nudge modal.

When triggered, the page calculates two lists and highlights every field in either of them:

**"Required" fields** (`REQUIRED_FIELD_CHECKS` — these used to be forced by an old onboarding wizard that no longer exists):
- Degree
- Industry
- Job title (occupation)
- Company
- City
- Postal code
- Profile photo

**"Skippable" fields** (`SKIPPABLE_FIELD_CHECKS` — things onboarding always let you skip past):
- Bio
- LinkedIn URL
- Phone number
- Business website
- Availability
- Areas of expertise (at least one)
- Geographic focus (at least one)

...plus your **CV** is added to the missing list separately if you haven't uploaded one.

Any field on either list that's currently blank gets a CSS class (`field-missing`) that visually flags it (a highlighted border/background — see the label wrapper `fieldCls()` helper in the code, which conditionally appends this class). If any of the missing fields belong to the Mentoring section (availability, expertise, geographic focus, business website), that collapsible section **auto-expands** so the highlighting is actually visible rather than hidden behind a closed toggle.

On top of the highlighting, a banner appears at the very top of the form:

> *"Let's finish your profile — everything still blank is highlighted below. Fill in what you can, then hit Save."*

with a small **"Dismiss"** link that clears all the highlighting (but again, doesn't touch the data).

If you arrived via the very-first-login route specifically (not the Home button), the page also **auto-scrolls to and focuses the first missing field** about 150 milliseconds after load, so your cursor lands exactly where you need to start typing — zero "now what do I do" moment.

Importantly: the moment you interact with a highlighted field (type in it, pick a value, toggle it), its individual highlight clears immediately — you don't have to click Save first to see the highlight go away, and you don't have to fix every field in one sitting.

---

## 5. Section-by-section walkthrough

The page is one long scrolling form, organized into clearly labelled sections in this exact top-to-bottom order:

### 5.1 Profile photo (hero section, no heading — sits right under the missing-fields banner)

A circular avatar (120px) that's actually a button — clicking the photo itself, or the **"Add photo" / "Profile picture"** button beside it, opens a **photo modal** (not the cropper yet — a smaller dialog first). Underneath is a hint: *"JPG, PNG or WebP • Max 8MB"*.

**The photo modal** (`ProfilePhotoModal`) shows your current photo large, with up to three action buttons depending on whether you already have a photo:
- **Edit** (only shown if you already have a photo) — re-opens the cropping tool on your *original, uncropped* upload, not the already-cropped version currently showing. This matters: if it re-used the cropped image, re-editing would zoom in further and further every time you touched it, with no way back to parts of the photo already cropped away the first time. The app quietly keeps a copy of your original file in storage (`avatars/<your-id>/original`) specifically so "Edit" can always start fresh from the full picture. If that original can't be found (e.g. a very old account from before this fix existed), it silently falls back to using your current avatar as the starting point instead.
- **Update** — opens your device's file picker to choose a brand-new photo entirely.
- **Delete** (only shown if you already have a photo) — removes your photo (see below).

**Choosing a new photo:** Only JPEG, PNG, or WebP files are accepted, and only files under 8MB. Anything else shows an inline error (*"Please choose a JPEG, PNG or WebP image."* or *"Photo must be under 8MB."*) rather than silently failing. The moment you pick a valid file, it's sent straight into the **photo cropper** (a separate full-screen tool — `PhotoCropper.jsx` — where you can zoom, pan, rotate and flip the image, plus apply filters, before saving). While that's happening, the app also fires off an upload of your *unedited original* file in the background (best-effort, doesn't block you) so future re-edits have something to start from.

**Saving a cropped photo:** When you hit save in the cropper, the editor deliberately stays open showing a "Saving…" state rather than closing immediately — this is so a slow connection never looks like your click did nothing. Behind the scenes: the cropped image uploads to storage under a **brand-new filename every time** (`avatars/<your-id>/avatar-<timestamp>.jpg`), specifically so it's never mistaken for a cached, stale copy of an old photo by browsers or the CDN. Your `profiles.avatar_url` and `profiles.avatar_crop` columns are updated to point at the new file, and afterwards the *previous* avatar file is deleted from storage in the background to avoid piling up orphaned images.

**Deleting your photo:** Removes both the current avatar file and the stashed "original" file from storage, and clears `avatar_url`/`avatar_crop` back to null. Your avatar then falls back to your initials in a coloured circle (handled by the shared `Avatar` component used across the whole site).

If your photo is one of the seven ten completion fields (see section 3) or is on the "required" missing-fields list, the whole photo card gets the highlighted `field-missing` styling around it.

### 5.2 "About you"

- **First name** / **Last name** — side-by-side text fields.
- **Preferred first name** — a separate optional field, placeholder text explains: *"If different — this is the name others see."* Your *display name* everywhere on the site (directory cards, your profile, messages) is built from **preferred name if you've set one, otherwise first name**, plus your last name.
- **Bio** — a 3-row expandable text area, placeholder *"What you've been up to since SACS…"*.
- **At SACS from** / **Class of** — two numeric year fields side by side ("start year" and "grad year"). Only digits are accepted as you type (non-digit characters are stripped automatically), capped at 4 digits.
- **Degree** — free-text field, e.g. "BCom Accounting".

### 5.3 "Career"

- **Industry** — a searchable dropdown (autocomplete) populated from a long fixed list of industries (e.g. Accounting & Finance, Agriculture & Wine, and many more) plus a keyword-search index so you can type things like "law" and have it suggest the right category. If your industry isn't in the list, you can type your own value — internally this is stored as `"Other"` with your custom text tracked separately, and it's the only value not "locked" to the fixed list.
- **Job title** and **Company** — plain text fields, side by side.

**Important interaction:** changing your Industry automatically drops any previously-picked "expertise" tags (used in the Mentoring section further down) that belonged to your *old* industry's tag list but don't exist in your *new* industry's list — so switching from, say, "Legal" to "Software Engineering" doesn't leave a stray "Litigation" tag sitting on your profile. Any custom-typed expertise tags (not tied to a specific industry's list) are always kept regardless of industry changes.

### 5.4 "Experience"

This is a free-form, add-as-many-as-you-like list of past/current roles — separate from the single "Job title / Company" fields above, which are what actually drive your directory card and search filters. Experience is purely for your own career-history timeline shown on your profile.

If you have none yet, it just shows: *"Add the roles you've held since SACS — they'll show up as a career timeline on your profile."*

Each entry, once saved/collapsed, shows as a **LinkedIn-style summary card**: title, company, a date range with computed duration (e.g. "Jan 2022 – Present · 4 yrs 8 mos"), and industry — with a pencil (edit) icon and a delete icon. Clicking the card body or the pencil expands it into a full edit form with these fields:
- **Title** and **Company name** (Company is required — leaving it blank while other fields in the same entry have content shows an inline error: *"Company name is required"*, and forces that entry to stay expanded so you can't miss it)
- **Industry** (same searchable dropdown as the main Career section)
- **Description** (optional, multi-line, for details/achievements/responsibilities)
- **From** / **To** — native month pickers. If you tick **"I currently work here,"** the "To" field is replaced by a fixed **"Present"** chip and disabled.

Each expanded entry has **Remove** and **Done** buttons. A brand-new entry (via **"+ Add position"**) opens already expanded; existing saved entries load collapsed.

**On save**, entries that are completely blank (an "Add" that was never filled in) are silently dropped. Any entry with *something* in it must have a company name, or the save is blocked with an error. Valid entries are automatically **re-sorted most-recent-first** — current roles first, then past roles ordered by end date — the same way LinkedIn orders a career timeline, so you never have to manually reorder them yourself.

### 5.5 "CV / Resume"

A single upload slot for your CV. Accepts PDF or Word documents (`.pdf`, `.doc`, `.docx`) up to 10MB. If you haven't uploaded one, you see a **"+ Upload CV"** button; once you have, it shows the filename as a clickable link plus **Replace** and **Remove** buttons.

Clicking the filename doesn't open a raw public link — it calls a helper (`openStorageFile`) that requests a short-lived **signed URL** from Supabase each time, because the CV storage bucket is private. Uploading a new CV automatically deletes the previous one from storage. This section gets the "missing" highlight treatment if you haven't uploaded a CV and arrived via the missing-fields flow.

### 5.6 "Location"

- **Country** — an autocomplete field defaulting to "South Africa".
- **City / Town** — an autocomplete with live place suggestions (backed by a mapping service). Hint text: *"Start typing and choose from suggestions."* Picking a suggestion from the dropdown also captures latitude/longitude coordinates for you automatically.
- **Address line 1 / 2 / 3** — free text, all optional.
- **Province** and **Post code** — side by side; post code is one of the "required" missing-fields.

**What the city field quietly does behind the scenes:** if you change your city (or country) and *didn't* pick a dropdown suggestion (so there are no ready-made coordinates), the app automatically looks up ("geocodes") your typed city name against a mapping service when you hit Save, so you show up correctly on the **Alumni Map** feature. If your profile doesn't have map coordinates yet at all (e.g. it was set before the map feature existed), it re-geocodes even if you didn't touch the city field this time. If the lookup fails to find your city, the save still goes through, but you get a small warning: *"Saved — but couldn't locate '[city]' for the Alumni Map. Double-check the spelling."* This lookup is skipped entirely on saves where nothing about your location changed and you already have a pin — so tweaking your bio doesn't trigger an unnecessary network lookup.

### 5.7 "Connect"

- **LinkedIn URL** — has a fixed, greyed-out **"https://"** prefix shown before the input box, so you only ever type the part after it (e.g. `linkedin.com/in/yourname`). Whatever you type has any `http://` or `https://` you happen to include stripped and re-added automatically, so there's no way to get the "must start with http(s)" validation error by pasting a bare link.
- **Phone number** — a dedicated phone input component. Hint text tells you: *"Who can see this is controlled in Settings → Privacy."* — phone visibility is a separate setting elsewhere (Settings page, Privacy tab), where you can set it to either **"All"** or **"Hide"** (same choice applies to your email address and your location, as three separate settings).

### 5.8 "SACS membership details" (collapsible)

Collapsed by default, toggled open with an arrow button. Explanatory hint: *"Used for the Alumni Association's membership records — not shown in the directory."* This is the section backed by the separate, tighter-security `profile_details` table.

- **Title** (Mr, Mrs, Ms, Miss, Dr, Prof, Rev, Adv, Other) and **Gender** (Male, Female, Other, Prefer not to say) side by side. Gender quietly defaults its dropdown display to "Male" for a never-before-saved record (this is a boys' school, so that's the sensible default) — but this is purely a *display* default; nothing is written until you actually save, and if you (or the record) ever holds any other value, that value always wins and is never silently overwritten back to Male.
- **Date of birth** — a native date picker.
- **Initials** and **Surname at school (if different)** — side by side, both optional.
- **ID / passport number** and **Nationality** — side by side.
- **Home phone** and **Work phone** — side by side, each its own phone input.
- **"Association with SACS"** — a row of toggle-able chip buttons, tick as many as apply: *Old Boy, Current parent, Past parent, Current staff, Past staff.* Hint: *"Tick everything that applies — these aren't mutually exclusive."*
- **"How can the Alumni Association reach you?"** — chip toggles for *Email, Phone, SMS.*
- **Membership tier** — shown as read-only text (e.g. "Standard — set by the Alumni Association office, not editable here").

### 5.9 "Mentoring" (collapsible)

Also collapsed by default, with a small dot indicator next to the section title if any of its fields are on the "missing" list (so the cue survives even after you manually collapse the section again). It has two independent halves — being a mentor, and looking for one yourself — because plenty of people are usefully both at once.

**Top gate — "Open to mentoring and other opportunities?"** A Yes/Not-right-now toggle. This single switch is the *only* thing that puts you into the "Find a Mentor" directory — there's no separate checkbox for it anymore. **This toggle saves instantly the moment you click it** (see section 7), not on the main Save button. When set to Yes, a confirmation hint appears: *"✓ You'll show up under Find a Mentor."* with a link to **"See how you appear →"** that jumps to the Mentoring section of the site.

When "Yes" is selected, additional fields appear:
- **Availability** — searchable dropdown: *Available now, Part-time available, By request/ad-hoc, Fully booked.*
- **Geographic focus** — a grid of toggle-able tag buttons: *Local (South Africa), Pan-Africa, Global, Remote only.*
- **Main areas you can mentor in** — a multi-select autocomplete whose *options change based on which Industry you picked* earlier in the Career section (falling back to a generic full list if no industry is set yet, with a hint prompting you to pick one). You can also type your own custom tags.
- **Anything else you'd like people to know?** — a free-text box (capped at 600 characters as you type) replacing what used to be a rigid list of "services offered" tags — the reasoning in the code comments is that a couple of sentences in someone's own words communicates more than a fixed checklist ever could.
- **"Are you currently available to mentor?"** — a second Available/Not-available toggle (separate from the main Yes/Not-right-now gate above) that lets you keep all your mentoring info visible on your profile while temporarily hiding yourself from the active mentor directory — e.g. if you're too busy right now but don't want to lose your setup. **This also saves instantly on click.**
- **Business website or portfolio** — optional URL field.

**Second half — "Looking for a mentor yourself?"** Another Yes/Not-right-now toggle (also **saves instantly**), independent of the mentor-side toggle above — you can be both a mentor and looking for one, or either alone. Hint: *"Say yes and mentors can find you under Find a Mentee, instead of you having to do all the asking."* When Yes:
- **"What do you want help with?"** — multi-select, same industry-scoped options as the mentor expertise field. This is explicitly what sorts the order of the "Find a Mentor" list *for you*, so the hint text tells you it's worth being specific.
- **Anything else a mentor should know?** — optional free text, 600-character cap with a live counter shown underneath.

---

## 6. Status messages, errors, and the Save bar

At the bottom of the form, above the action buttons:
- Any validation or save error appears as a red error message.
- The geocoding warning (section 5.6) appears separately if relevant.

**Action buttons, left to right:**
- **Save changes** — the primary button; shows "Saving…" and disables itself while a save is in progress.
- **Sign out** — signs you out of the app immediately.
- **Delete account** — opens a confirmation dialog (not a plain browser popup) warning: *"This will permanently remove your profile, posts, messages and photos, and cannot be undone."* Confirming calls a server-side function that deletes your actual login/auth account (not just the profile row) — this cascades and removes all your data. Once done, you're signed out and the page reloads. To sign back in afterwards you'd need to sign up again from scratch, since the account itself is gone, not just deactivated.
- After a successful save, a green **"✓ Saved"** chip briefly appears next to the buttons.

---

## 7. What saves instantly vs. what needs the "Save changes" button

This is an important distinction the page makes on purpose:

**Saves the instant you click it** (no need to hit "Save changes," and it can't be silently lost by an unrelated error elsewhere on the page, like a bad LinkedIn URL blocking the whole form):
- "Open to mentoring and other opportunities?" (Yes / Not right now)
- "Are you currently available to mentor?" (Available / Not currently available)
- "Looking for a mentor yourself?" (Yes / Not right now)
- Uploading, replacing, or removing your **photo**
- Uploading, replacing, or removing your **CV**

These are deliberately treated as on/off *status switches* rather than draft form fields — the reasoning documented directly in the code is that routing them through the big multi-field save would let them sit "changed but unsaved" or get silently blocked by an unrelated validation error somewhere else on the long form, with nothing telling you why your click "didn't hold." Making the click itself the save removes that failure mode entirely. If one of these instant-saves fails (e.g. a network hiccup), the toggle visually reverts to its previous state and an error message appears.

**Everything else on the page** — name, bio, years, degree, career, experience entries, location/address, LinkedIn, phone, all the SACS membership-details fields, availability, geographic focus, expertise tags, mentor/mentee notes, business website — only saves when you click the **"Save changes"** button.

## 8. What happens when you click "Save changes"

In order:

1. **Validation runs first**, and stops at the first problem found:
   - First and last name can't be blank.
   - City can't be blank.
   - Graduation year must be a valid 4-digit year.
   - LinkedIn URL, if present, must be a safe `http://` or `https://` link.
   - Business website: a bare domain like `mysite.com` is quietly given a `https://` prefix rather than failing the save.
   - Any Experience entry with *any* content must have a company name.
2. Experience entries are cleaned (blank ones dropped) and re-sorted most-recent-first, as described in section 5.4.
3. Free-text fields are trimmed of stray leading/trailing whitespace before saving (name, degree, occupation, company, city, bio, LinkedIn, phone, business website, mentor/mentee notes, and all three address lines) — this keeps the directory and search results from ever showing a name or bio with invisible extra spaces, regardless of which screen (this page vs. the original signup flow) last touched the row.
4. Your **display name** is rebuilt as `(preferred name, or first name if none) + last name` — matching how the signup flow builds it, so it's consistent everywhere.
5. **City coordinates are recalculated if needed** — see the geocoding logic in section 5.6.
6. The `profiles` table is updated with everything above, in a single database write.
7. The `profile_details` table is then updated (or created, if this is your first time saving it) with everything from the SACS membership-details section — again trimmed for the free-text fields (ID number, nationality, both phone numbers, initials, surname at school), with a blank date-of-birth stored as an empty value rather than an invalid one.
8. If either write fails, you see the specific database error message and nothing further happens.
9. On full success: the parent app is told your profile changed (so, for example, the directory refreshes to reflect it), the green "✓ Saved" chip appears, and the "unsaved changes" warning flag clears.

**Unsaved-changes protection:** while you have edits on this page that haven't been saved, the app tracks that as "dirty." If you try to navigate to a different page inside the site, you get a prompt asking whether to save and leave, discard and leave, or keep editing. If you try to close the browser tab, refresh, or navigate away from the site entirely, the browser's own native "leave site?" warning appears too. This protection is scoped specifically to the profile page.

---

## 9. How this page's data shows up elsewhere

- **`ProfileModal.jsx`** — the read-only pop-up other members see when they click on you in the directory or elsewhere (also what you'd see clicking your own card, marked "You"). It displays: photo, role/company line, location (fetched separately through a privacy-aware lookup that respects your Settings → Privacy choices, so it never shows more than you've allowed), grad year, degree, industry, bio, your Experience timeline, phone/email (again privacy-filtered), and — only if you've actually filled in anything there — a Mentoring section showing whether you're open to opportunities, availability, business website, your expertise tags, and geographic focus. Fields you've left blank are simply omitted rather than shown as empty.
- **Home page** — the completion ring, hero subtitle/button, and the once-a-day nudge modal, all described in section 3.
- **Mentoring section of the site** — reads `is_open_to_opportunities`, `seeking_mentor`, `availability`, `mentor_paused`, `expertise`, `mentee_goals`, and the notes fields to build the "Find a Mentor" / "Find a Mentee" directories.
- **Alumni Map** — reads your latitude/longitude (set via the city geocoding described above).
- **Old Boys directory & search** — reads most of the core `profiles` fields (name, photo, role, company, location, industry) directly.

---

## 10. Technical file map (for reference)

| What | File |
|---|---|
| The edit page itself | `src/components/Profile.jsx` |
| Read-only profile pop-up others see | `src/components/ProfileModal.jsx` |
| Once-a-day incomplete-profile nudge | `src/components/CompleteProfilePrompt.jsx` |
| Home page (completion ring, hero, nudge trigger) | `src/components/Home.jsx` |
| Photo cropping tool | `src/components/PhotoCropper.jsx` |
| Dropdown option lists (industries, titles, genders, etc.) | `src/constants.js` |
| Route wiring (`/profile`) | `src/App.jsx` |
| Database tables | `profiles`, `profile_details` (see `docs/DATABASE.md`) |

