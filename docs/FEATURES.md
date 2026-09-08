# FEATURES.md — Living Feature Inventory

> Only documents features actually discovered in the codebase.
> Each entry lists status, key files, database tables, and known issues or gaps.

---

## Status Key

| Label | Meaning |
|-------|---------|
| **IMPLEMENTED** | Feature is fully built, wired to the database, and usable by members |
| **PARTIAL** | Core UI/logic exists but a critical dependency is missing or disabled |
| **STUB** | Placeholder page or component; no real functionality yet |

---

## 1. Authentication & Account Lifecycle

**Status:** IMPLEMENTED

Sign up (email/password or Google OAuth), email confirmation, password recovery, account deletion (self-service and admin-initiated via Edge Functions).

**Key files:**
- `src/components/Auth.jsx` — login/signup wizard (email + Google)
- `src/components/FinishSignup.jsx` — post-Google-OAuth consent + detail capture
- `src/components/CompleteDetails.jsx` — step 2: membership record fields
- `src/components/ResetPassword.jsx` — password recovery flow
- `src/components/PendingVerification.jsx` — shown while awaiting admin approval
- `src/supabaseClient.js` — `deleteOwnAccount()`, `adminDeleteAccount()`
- `src/authErrors.js` — human-friendly auth error messages
- `src/authRedirect.js` — redirect URL builder for OAuth/magic links
- `src/passwordRules.jsx` — strength meter + validation
- `supabase/functions/delete-account/` — Edge Function: self-deletion
- `supabase/functions/admin-delete-member/` — Edge Function: admin deletion
- `supabase/functions/_shared/accountCleanup.ts` — shared storage/data teardown

**Database tables:** `profiles` (auth fields: `consented_at`, `details_completed_at`, `approved`, `declined_at`, `is_admin`, `email_confirmed_at`, `deleted_at`)

**Auth flow (in render order in App.jsx):**
1. Loading → 2. Recovery mode → 3. No session (Auth) → 4. Profile loading → 5. Deleted account → 6. Error → 7. Declined → 8. No consent (FinishSignup) → 9. No details (CompleteDetails) → 10. Not approved (PendingVerification) → 11. Full app

**Known issues / gaps:**
- Cloudflare Turnstile (`src/components/Turnstile.jsx`) is imported and rendered but `VITE_TURNSTILE_SITE_KEY` is not yet configured — bot protection is inactive.
- Resend email service is referenced in Edge Functions but not yet configured.

---

## 2. Home Dashboard

**Status:** IMPLEMENTED

Landing page after login. Shows profile completion bar, recent feed posts, community section (who's online, nearby alumni), nearby businesses, upcoming events, and the Notable Old Boys (Legends) band.

**Key files:**
- `src/components/Home.jsx` — dashboard layout, completion meter, mobile tab pills
- `src/components/WhosOnline.jsx` — "Who's Online" presence widget
- `src/components/CompleteProfilePrompt.jsx` — modal nudge for incomplete profiles
- `src/components/Legends.jsx` (`LegendsBand`) — rotating hero mosaic

**Database tables:** `profiles` (completion fields, `last_seen`), `posts`, `businesses`, `events`, `legends`

**Route:** `/home` (default)

---

## 3. Alumni Directory ("Old Boys")

**Status:** IMPLEMENTED

Searchable, filterable member directory with List and Map views sharing one filter state. Cards show avatar, name, grad year, industry, occupation, company, city, online status. Click opens profile modal. "For You" default sort uses a seeded-hash shuffle (stable per viewer, different across viewers).

**Key files:**
- `src/components/People.jsx` — view toggle (List ↔ Map), shared filter state
- `src/components/Directory.jsx` — list view, `Avatar`, `PhotoBlock`, `OnlineDot` exports
- `src/components/DirectoryFilters.jsx` — `useDirectoryFilters` hook + filter UI
- `src/components/AlumniMap.jsx` — Leaflet map, city-based clustering, popups
- `src/components/PersonProfile.jsx` — standalone `/people/:id` page
- `src/components/ProfileModal.jsx` — in-app profile popup (used from Feed, Jobs, etc.)

**Database tables:** `profiles` (all member fields), `badges`

**Route:** `/directory` (list default), `/directory?view=map`

---

## 4. Alumni Map

**Status:** IMPLEMENTED

Leaflet + Mapbox tile map plotting all approved members who have lat/lng coordinates. People sharing a city/country cluster onto one numbered pin (centroid positioning). FitToMarkers auto-zooms. Integrated into People.jsx as the Map tab of the directory.

**Key files:**
- `src/components/AlumniMap.jsx` — map rendering, clustering, popups
- `src/mapTiles.js` — Mapbox tile URL, attribution config
- `src/geocode.js` — Mapbox geocoding for city names → lat/lng

**Database tables:** `profiles` (`lat`, `lng`, `city`, `country`)

**Route:** `/directory?view=map`

---

## 5. Feed (Posts)

**Status:** IMPLEMENTED

Social feed with rich-text posts (WYSIWYG editor), up to 4 images per post, likes, comments, search, profile modals on author click. Supabase Realtime subscription for live updates. Posts are paginated (10 per page, load-more).

**Key files:**
- `src/components/Feed.jsx` — full feed: composer, post list, comments, likes, image upload
- `src/components/RichTextEditor.jsx` — WYSIWYG contenteditable editor
- `src/components/RichTextToolbar.jsx` — basic formatting toolbar
- `src/sanitizeHtml.js` — DOMPurify wrapper for post content

**Database tables:** `posts`, `post_likes`, `post_comments`

**Storage buckets:** `post-images` (public)

**Route:** `/feed`

**Known issues / gaps:**
- Video uploads are coded but disabled (`VIDEO_UPLOADS_ENABLED = false`). The `post-videos` bucket does not exist in the Supabase project. To enable: create the bucket (SQL in schema-update-47.sql comments), flip the flag.

---

## 6. Contact via Email

**Status:** IMPLEMENTED

Replaces the earlier real-time DM feature (removed schema-update-63). Every "Message" button
throughout the app opens a one-shot compose dialog (subject + message) instead of a chat thread.
Sending calls the `send-contact-email` Edge Function, which relays the message to the recipient
through Resend, with Reply-To set to the sender's own address so replies land directly in the
sender's inbox. Nothing is stored — no thread, no history, no database row — the moment the email
is sent, the interaction only exists in the two people's actual inboxes.

**Key files:**
- `src/components/ContactModal.jsx` — the compose dialog (subject, message, send)
- `supabase/functions/send-contact-email/index.ts` — looks up the recipient's email server-side
  (never exposed to the sender's browser) and calls the Resend API
- `src/App.jsx` — `openMessage(targetProfile, draftText)` opens the modal; unchanged call
  signature from every "Message" button across the app

**Database tables:** none.

**Known issues / gaps:** Requires `RESEND_API_KEY` to be set as an Edge Function secret and a
verified sending domain in Resend — without it, sends fail with "Email sending is not configured
yet". No rate limiting on how many contact emails a member can send.

---

## 7. Events

**Status:** IMPLEMENTED

Event listing with RSVP, comments, map pins (Leaflet), calendar export (.ics), event creation form with rich-text description and location geocoding. Events split into upcoming/past. Clustered map view for events with coordinates.

**Key files:**
- `src/components/Events.jsx` — event list, detail view, RSVP, comments, map
- `src/components/EventFormEnhanced.jsx` — create/edit event form with geocoding
- `src/components/DateTimePicker.jsx` — date/time input component
- `src/ics.js` — RFC 5545 iCalendar export (no external dependency)

**Database tables:** `events`, `event_rsvps`, `event_comments`

**Storage buckets:** `event-images` (public)

**Route:** `/events`, `/events/:id`

---

## 8. Jobs Board

**Status:** IMPLEMENTED

Job listings with filters (type, remote, company, location, industry, recency, include-closed toggle). Rich-text descriptions, company logos, file attachments, apply URL or in-app application. "New" badge for posts < 48h old. Closing-date awareness (local-day comparison). Icebreaker integration for "People like you" matching. Map pins for geolocated jobs.

**Key files:**
- `src/components/Jobs.jsx` — job list, filters, create/edit form, map pins
- `src/components/JobDetail.jsx` — standalone job page
- `src/components/JobApplications.jsx` — applications list (visible to poster)
- `src/components/ApplyModal.jsx` — in-app job application form (cover letter + CV + files)

**Database tables:** `jobs`, `job_applications`, `saved_jobs`

**Storage buckets:** `job-logos` (public), `job-attachments` (public), `job-application-files` (private — signed URLs, 60s expiry)

**Route:** `/jobs`, `/jobs/:id`

---

## 9. Business Directory

**Status:** IMPLEMENTED

Alumni business listings with logos, cover images, rich-text descriptions, map pins (city-based clustering like Alumni Map), category/industry classification, website links. Feature-pin capability (admin). Businesses share the same clustering and FitToMarkers patterns as the Alumni Map.

**Key files:**
- `src/components/BusinessDirectory.jsx` — business list, create/edit, map, detail view
- `src/components/BusinessDetail.jsx` — standalone business page
- `src/components/BusinessLogo.jsx` — logo display component
- `src/components/BusinessDescriptionEditor.jsx` — rich-text editor for business descriptions

**Database tables:** `businesses`

**Storage buckets:** `business-logos` (public), `business-covers` (public)

**Route:** `/businesses`, `/businesses/:id`

---

## 10. Mentoring

**Status:** IMPLEMENTED

Two-path mentoring system:
1. **Flash mentoring** — message anyone open to it, no commitment, no database row.
2. **Structured mentorship** — request → accept → goals → session log → close. Full lifecycle tracked in DB.

Mentor/mentee discovery with scoring (`mentorMatch.js`), availability/expertise matching. Mentees are discoverable (not just mentors). Icebreaker-powered openers. Mentorship workspace for active pairings (goals, session notes).

**Key files:**
- `src/components/Mentoring.jsx` — mentor/mentee tabs, discovery, "My mentoring"
- `src/components/MentorshipRequestModal.jsx` — structured mentorship request form
- `src/components/MentorshipWorkspace.jsx` — active mentorship: goals, sessions, close
- `src/mentorMatch.js` — scoring algorithm (availability, expertise overlap, geo, grad-year)
- `src/icebreaker.js` — `buildIcebreaker()` for flash-mentoring openers

**Database tables:** `mentorships`, `mentorship_goals`, `mentorship_sessions`

**Profile fields used:** `is_open_to_opportunities`, `mentor_capacity`, `mentor_paused`, `seeking_mentor`, `mentee_goals`, `mentee_note`, `expertise`, `availability`, `geographic_focus`

**Route:** `/mentoring`

---

## 11. Notable Old Boys ("Legends" / "Hoek van Helde")

**Status:** IMPLEMENTED

Admin-curated gallery of notable SACS alumni. Photo-driven design (full-bleed portrait, dark scrim, white text). Home page shows a rotating 3-tile mosaic (Fisher–Yates shuffle on each load). Standalone hall page and individual profile pages. Categories: Sport, Business, Politics, Arts, Academia, Military, Medicine, Media, Public Service, SACS.

**Key files:**
- `src/components/Legends.jsx` — `LegendsBand` (home mosaic), `LEGEND_CATEGORIES`, shuffle
- `src/components/LegendsHall.jsx` — full gallery page
- `src/components/LegendProfile.jsx` — individual legend page

**Database tables:** `legends` (admin-curated, not linked to member profiles)

**Route:** `/legends`, `/legends/:id`

---

## 12. Merch Shop

**Status:** PARTIAL

Product catalog with category filters, search, variant system (size/color with price deltas and stock tracking). Cart (React context, in-memory), checkout flow with `place_merch_order` RPC (stock check + order creation). Order tracking ("My Orders") with status labels. Admin panel for product/variant CRUD and order status management.

**Key files:**
- `src/components/Shop.jsx` — product grid, category pills, search
- `src/components/ShopProduct.jsx` — product detail, variant picker
- `src/components/Cart.jsx` — cart page
- `src/components/CartContext.jsx` — React context for cart state
- `src/components/Checkout.jsx` — order placement (RPC call)
- `src/components/MyOrders.jsx` — member's order history + cancellation
- `src/components/MerchAdmin.jsx` — admin: product CRUD, order management

**Database tables:** `merch_products`, `merch_variants`, `merch_orders`, `merch_order_items`

**Storage buckets:** `merch-images` (public)

**Route:** `/shop`, `/shop/:id`, `/cart`, `/checkout`, `/orders`

**Known issues / gaps:**
- No payment gateway integrated. Checkout creates an order (status: `pending`) but no real charge occurs. The admin must confirm payment externally before advancing the order. Comment in Checkout.jsx says to swap in PayFast or Stripe later.

---

## 13. Photo Albums

**Status:** IMPLEMENTED

Photo albums with multiple image uploads. Discovered via database tables and storage bucket — the feature is wired into the app.

**Database tables:** `photo_albums`, `photos`

**Storage buckets:** `album-photos` (public)

---

## 14. Notifications

**Status:** IMPLEMENTED

Bell icon in header with unread badge (server-counted). Dropdown shows recent notifications (30 per page). Real-time via Supabase insert subscription. Click-through routing by entity type (post → feed, event → events, job → jobs, member → admin, mentorship → mentoring).

**Key files:**
- `src/components/NotificationBell.jsx` — bell + dropdown, realtime subscription

**Database tables:** `notifications`, `notification_preferences`

**Notification categories (Settings):** post activity (like/comment), event RSVP, event comment.

---

## 15. Global Search

**Status:** IMPLEMENTED

Header search button opening a modal. Four parallel queries (people, posts, jobs, businesses) with 5-row preview per category + "See all N results" expansion (up to 50). Debounced keystroke input. Click-through to entity.

**Key files:**
- `src/components/GlobalSearch.jsx` — search modal, parallel queries, category tabs

---

## 16. Profile Management

**Status:** IMPLEMENTED

Full profile editor with sections: personal info, SACS record, professional details, mentoring preferences, experience timeline, CV upload, avatar upload with crop/rotate/filter editor. Profile details stored in a separate `profile_details` table with tighter RLS.

**Key files:**
- `src/components/Profile.jsx` — main profile editor (multi-section form)
- `src/components/PhotoCropper.jsx` — avatar crop/rotate/flip/filter modal

**Database tables:** `profiles`, `profile_details`

**Storage buckets:** `avatars` (private), `cvs` (private)

**Route:** `/profile`

---

## 17. Settings

**Status:** IMPLEMENTED

Three-tab settings page:
1. **Account** — change password, delete account (with Turnstile challenge when configured)
2. **Notifications** — per-category toggle (post activity, event RSVP, event comment)
3. **Privacy** — visibility controls for phone, email, location (all/hide)

**Key files:**
- `src/components/Settings.jsx` — settings tabs, password change, account deletion, notification prefs, privacy controls

**Database tables:** `profiles`, `notification_preferences`

**Route:** `/settings`

---

## 18. Admin Panel

**Status:** IMPLEMENTED

Full administration interface for committee members (`is_admin = true`). Organized into four groups:

**People:** Pending approval (approve/decline new signups, triggers approval email Edge Function), Members (search, filter by status, un-approve, admin-delete via Edge Function, select any number of filtered/searched members and send them a rich-text/newsletter-style broadcast email -- headings, formatting, links, inline images -- via Edge Function), Reports (review member-flagged content).

**Content:** Posts (browse/delete), Jobs (browse/delete), Events (browse/delete), Businesses (browse/delete/feature-pin).

**Shop:** Merch & Orders (product CRUD, variant management, order status flow).

**Site:** Notable Old Boys (legend CRUD with photo upload), Activity log (immutable admin_actions audit trail), Handbook (built-in guide for committee members).

**Key files:**
- `src/components/Admin.jsx` — main admin panel, all People/Content/Site tabs
- `src/components/AdminHandbook.jsx` — built-in handbook for admin users
- `src/components/MerchAdmin.jsx` — merch product and order management
- `supabase/functions/send-approval-email/` — Edge Function: approval notification
- `supabase/functions/send-member-email/` — Edge Function: admin-to-member email
- `src/components/EmailEditor.jsx` — WYSIWYG editor used only by the broadcast composer (headings, bold/italic/underline, alignment/indent, lists, links, inline images uploaded to the `broadcast-email-images` bucket, dividers, emoji); sanitized with `sanitizeEmailHtml` (`src/sanitizeHtml.js`)
- `supabase/functions/send-broadcast-email/` — Edge Function: admin broadcast email to a selected group of members, batched through Resend, opted-out members skipped, message HTML re-sanitized server-side as a backstop
- `supabase/functions/admin-delete-member/` — Edge Function: full account deletion

**Database tables:** `profiles`, `posts`, `jobs`, `events`, `businesses`, `reports`, `legends`, `merch_products`, `merch_variants`, `merch_orders`, `admin_actions`, `notification_preferences` (read-only, for the broadcast opt-out)

**Storage buckets:** `broadcast-email-images` (public, admin-only write, schema-update-67) — inline images an admin drops into a broadcast email; needs a public URL since the recipient's mail client fetches it directly.

**Security:** Admin status checked via `is_admin` column on `profiles`. Self-elevation prevented by a `BEFORE UPDATE` trigger. Most admin actions are logged to `admin_actions` by database triggers (immutable audit trail); `delete_member` and `send_broadcast_email` insert directly with the service-role key instead, since a service-role write has no `auth.uid()` for a trigger to key off.

**Known issues / gaps (broadcast email):** Requires `RESEND_API_KEY` (see § Contact via Email). Recipients who've opted out (`notification_preferences.notify_admin_broadcast = false`, schema-update-66) can only manage that from Settings while logged in — there's no one-click unsubscribe link in the email itself, unlike a typical mailing-list tool. Capped at 1000 recipients per send as a safety rail against an accidental mass-select. No saved/reusable templates and no send preview yet — an admin sees the same live editor they're typing into, not a rendered mock of the final email.

**Route:** `/admin` (only visible in nav when `is_admin = true`)

---

## 19. Donations

**Status:** STUB

Static placeholder page. Three pillars described (bursaries, school projects, reunions/events). "Get in touch" button links to `mailto:` — no payment integration.

**Key files:**
- `src/components/Donate.jsx` — static page

**Route:** `/donate`

**Known issues / gaps:**
- No payment gateway. Comment says to hook up PayFast or Stripe when ready.

---

## 20. Privacy Policy

**Status:** IMPLEMENTED

POPIA-compliant privacy notice (section 18 of the Protection of Personal Information Act). Rendered as both a full page (`/privacy`) and a modal (used in signup flows before a session exists). Covers: what's collected, why, who processes it, retention, section 23/24 rights.

**Key files:**
- `src/components/PrivacyPolicy.jsx` — `PrivacyPolicyContent` + `PrivacyPolicyModal`

**Route:** `/privacy`

---

## 21. Reporting / Flagging

**Status:** IMPLEMENTED

Shared "Report" button used across posts, jobs, businesses, profiles. Writes to `reports` table. Reason categories: spam/misleading, harassment/abuse, inappropriate, scam/fraud, other. Not gated behind approval (safety action). Duplicate-report prevention (client-side check). Admin reviews reports in Admin → Reports tab.

**Key files:**
- `src/components/ReportButton.jsx` — shared report button + modal

**Database tables:** `reports`

---

## 22. Presence / "Who's Online"

**Status:** IMPLEMENTED

Heartbeat system: App.jsx updates `profiles.last_seen` periodically. `isRecentlyOnline()` utility checks recency. Green dot indicator on avatars. "Who's Online" widget on Home page.

**Key files:**
- `src/components/WhosOnline.jsx` — online members widget
- `src/components/Directory.jsx` — `OnlineDot` component
- `src/utils.js` — `isRecentlyOnline()`
- `src/App.jsx` — heartbeat updater

**Database tables:** `profiles` (`last_seen`)

---

## 23. Icebreaker System

**Status:** IMPLEMENTED

Auto-generated conversation starters based on shared profile attributes (currently: industry match). Used in directory cards, mentoring, job listings. Event-specific icebreaker for co-attendees.

**Key files:**
- `src/icebreaker.js` — `buildIcebreaker()`, `matchReason()`, `eventIcebreaker()`

---

## 24. Badges

**Status:** IMPLEMENTED

Badge system with definitions in `src/constants.js`. Displayed on profile cards/modals.

**Database tables:** `badges`

**Key files:**
- `src/constants.js` — badge definitions

---

## Shared Infrastructure Components

These are not features themselves but are used across multiple features:

| Component | File | Used by |
|-----------|------|---------|
| Rich Text Editor | `RichTextEditor.jsx`, `RichTextToolbar.jsx`, `RichTextToolbarExtended.jsx` | Feed, Jobs, Events, Businesses |
| Avatar / PhotoBlock | `Directory.jsx` (exports) | Everywhere |
| Empty State | `EmptyState.jsx` | All list views |
| Loading State | `LoadingState.jsx` | All async views |
| Confirm Dialog | `ConfirmDialog.jsx` | Delete actions, account deletion |
| Delete Button | `DeleteButton.jsx` | Posts, jobs, events, businesses, legends |
| Toast Notifications | `Toast.jsx` | App-wide feedback |
| City Autocomplete | `CityAutocomplete.jsx` | Profile, events, jobs, businesses |
| Country Autocomplete | `CountryAutocomplete.jsx` | Profile, signup |
| List Autocomplete | `ListAutocomplete.jsx` | Jobs, profile |
| Multi-Select Autocomplete | `MultiSelectAutocomplete.jsx` | Jobs, profile |
| Phone Input | `PhoneInput.jsx` | Profile, signup |
| Clearable Input | `ClearableInput.jsx` | Profile |
| Dropdown Portal | `DropdownPortal.jsx` | Autocomplete components |
| Photo Cropper | `PhotoCropper.jsx` | Avatar upload |
| Discard Guard | `useDiscardGuard.jsx` | Feed, jobs, businesses, profile |
| Modal Hook | `useModal.js` | Global search, photo cropper, report, profile modal |
| Listbox Keys | `useListboxKeys.js` | Autocomplete components |
| Geocoding | `geocode.js` | Profile, events, jobs, businesses |
| Map Tiles | `mapTiles.js` | Alumni map, events, businesses |
| HTML Sanitizer | `sanitizeHtml.js` | Feed, jobs, businesses |
| IP Location | `ipLocation.js` | Signup (country pre-fill) |
| Turnstile | `Turnstile.jsx` | Auth, settings (inactive) |
| Error Boundary | `ErrorBoundary.jsx` | App root |
| 404 Page | `NotFound.jsx` | Unmatched routes |
