# SACS Alumni Hub — Architecture

## Overview

SACS Alumni Hub is a private community platform for alumni of South African College Schools (SACS). It provides a directory, social feed, member-to-member email contact, events, jobs, a business directory, mentoring, a merch shop, and a Notable Old Boys spotlight. The site is gated: anyone can sign up, but all content is locked behind admin approval verified against school records.

## Technology Stack

| Technology | Version | Role |
|---|---|---|
| React | 18.3 | UI framework (SPA) |
| Vite | 5.4 | Build tool + dev server |
| react-router-dom | 6.30 | Client-side routing |
| Supabase JS | 2.45 | Database client, auth, storage, realtime, edge functions |
| Leaflet + react-leaflet | 1.9 / 4.2 | Interactive maps |
| DOMPurify | 3.4 | HTML sanitization for rich text |
| Vanilla CSS | — | Single stylesheet with custom properties |
| Vercel | — | Static hosting with SPA rewrite |
| Supabase (hosted) | — | PostgreSQL, Auth, Storage, Edge Functions, Realtime |
| Mapbox | — | Map tiles + geocoding API |
| Cloudflare Turnstile | — | Bot protection on signup (not yet active) |
| Resend | — | Transactional email (not yet configured) |

**Not used:** TypeScript, testing frameworks, linters, CSS frameworks, state management libraries, SSR/SSG, API routes, backend servers.

## Application Structure

```
sacs-hub/
├── index.html              — Vite entry point
├── vite.config.js          — Vite config (manual chunks for React, Leaflet, Supabase)
├── vercel.json             — Vercel: SPA rewrite + security headers (CSP, HSTS, etc.)
├── package.json            — 7 runtime deps, 2 dev deps
├── .env.example            — Environment variable template
├── CLAUDE.md               — AI operating manual (this project)
│
├── src/
│   ├── main.jsx            — React root: BrowserRouter, ToastProvider, ErrorBoundary
│   ├── App.jsx             — Root component: auth flow, routing, layout shell (~900 lines)
│   ├── supabaseClient.js   — Supabase client init + shared helpers (auth, storage, cleanup)
│   ├── styles.css          — ALL CSS (~11,000 lines), design tokens at top
│   ├── constants.js        — Dropdown option lists, industry keywords, badge definitions
│   ├── utils.js            — Shared utilities (ranking, formatting, validation, hooks)
│   ├── authErrors.js       — Friendly auth error messages
│   ├── authRedirect.js     — OAuth redirect URL builder
│   ├── geocode.js          — Mapbox geocoding wrapper
│   ├── icebreaker.js       — Random conversation starters for the Home dashboard
│   ├── ics.js              — iCal file generation for events
│   ├── ipLocation.js       — IP-based location for "near me" features
│   ├── mapTiles.js         — Mapbox tile URL config
│   ├── mentorMatch.js      — Mentor matching algorithm
│   ├── passwordRules.jsx   — Password validation + strength meter
│   ├── richText.jsx        — Rich text rendering helpers
│   ├── richTextExtended.jsx— Extended rich text (business descriptions)
│   ├── sanitizeHtml.js     — DOMPurify configuration
│   ├── useListboxKeys.js   — Keyboard nav hook for custom listboxes
│   └── useModal.js         — Modal open/close hook
│
│   └── components/         — One file per page/feature (~90 files)
│       ├── Auth.jsx             — Sign in / sign up / forgot password (3-step wizard)
│       ├── FinishSignup.jsx     — Social login catch-up form
│       ├── CompleteDetails.jsx  — Legacy membership details form
│       ├── PendingVerification.jsx — "Waiting for admin" screen
│       ├── Home.jsx             — Dashboard: greeting, completion bar, feed, events, businesses
│       ├── People.jsx           — Old Boys directory wrapper (list + map toggle)
│       ├── Directory.jsx        — Directory list with Avatar component
│       ├── DirectoryFilters.jsx — Directory search + filter panel
│       ├── AlumniMap.jsx        — Leaflet map of alumni locations
│       ├── Feed.jsx             — Social feed: posts, likes, comments
│       ├── Events.jsx           — Events board + calendar
│       ├── Jobs.jsx             — Job listings
│       ├── JobDetail.jsx        — Individual job page
│       ├── JobApplications.jsx  — Job application viewer (poster's view)
│       ├── BusinessDirectory.jsx— Business listings + map
│       ├── BusinessDetail.jsx   — Individual business page
│       ├── Mentoring.jsx        — Mentor matching + workspace
│       ├── MentorshipWorkspace.jsx — Active mentorship management
│       ├── ContactModal.jsx     — Compose-email dialog opened by any "Message" button
│       ├── Profile.jsx          — Self-editable profile (~1,800 lines)
│       ├── PersonProfile.jsx    — Read-only view of another member
│       ├── Settings.jsx         — Account settings, privacy, deletion
│       ├── Admin.jsx            — Admin panel: approve/decline, moderate, curate
│       ├── Shop.jsx             — Merch store listing
│       ├── ShopProduct.jsx      — Individual product page
│       ├── Cart.jsx             — Shopping cart
│       ├── Checkout.jsx         — Checkout flow
│       ├── MyOrders.jsx         — Order history
│       ├── LegendsHall.jsx      — Notable Old Boys gallery
│       ├── LegendProfile.jsx    — Individual legend page
│       ├── Donate.jsx           — Support/donate page (stub)
│       ├── NotificationBell.jsx — Header notification dropdown
│       ├── GlobalSearch.jsx     — Cross-feature search
│       └── [shared UI]         — ConfirmDialog, EmptyState, LoadingState, Toast,
│                                  PhotoCropper, RichTextEditor, DateTimePicker,
│                                  ClearableInput, PasswordInput, PhoneInput,
│                                  CityAutocomplete, CountryAutocomplete,
│                                  ListAutocomplete, MultiSelectAutocomplete,
│                                  DropdownPortal, DeleteButton, ReportButton,
│                                  ErrorBoundary, Turnstile, etc.
│
├── public/                 — Static assets (logos, PWA manifest, og-image)
│
├── supabase/
│   ├── functions/
│   │   ├── _shared/accountCleanup.ts  — CORS, storage purge, user deletion
│   │   ├── delete-account/index.ts    — Self-service account deletion
│   │   ├── admin-delete-member/index.ts — Admin removes a member
│   │   ├── send-approval-email/index.ts — Email on approval (needs Resend)
│   │   ├── send-member-email/index.ts   — Admin-to-member email (needs Resend)
│   │   └── send-broadcast-email/index.ts — Admin -> selected members, batched (needs Resend)
│   └── email-templates/
│       ├── confirm-signup.html  — Supabase Auth confirmation email
│       └── reset-password.html  — Supabase Auth reset email
│
├── schema.sql              — Original baseline schema (historical)
├── schema-all.sql          — Consolidated schema (migrations 0–57, read-only reference)
└── schema-update-*.sql     — Individual migrations (0–62, run in SQL Editor)
```

## Frontend Architecture

### Routing

All routing is client-side via `react-router-dom`. `vercel.json` rewrites all paths to `index.html`. Routes are defined in `App.jsx`:

- `/` → redirects to `/home`
- `/home` — Dashboard
- `/directory` — Old Boys directory (includes alumni map as a view toggle)
- `/feed`, `/feed/:postId` — Social feed
- `/mentoring` — Mentoring
- `/events`, `/events/:eventId` — Events
- `/jobs` — Job listings
- `/jobs/:jobId` — Job detail
- `/businesses` — Business directory
- `/businesses/:businessId` — Business detail
- `/shop`, `/shop/:productId`, `/shop/cart`, `/shop/checkout`, `/shop/orders` — Merch
- `/legends`, `/legends/:legendId` — Notable Old Boys
- `/profile` — Edit own profile
- `/people/:personId` — View another member's profile
- `/settings` — Account settings
- `/admin` — Admin panel (gated on `profile.is_admin`)
- `/donate` — Support page
- `/privacy` — Privacy policy
- `*` — 404

### Code Splitting

Route-level code splitting via `React.lazy()`. Eagerly loaded: Auth, Home, People, header chrome (notifications, dialogs). Everything else loads on first navigation. Vite's `manualChunks` splits vendor code into three cached bundles: `vendor-react`, `vendor-leaflet`, `vendor-supabase`.

### Layout

- **Desktop:** Sticky navy header → hero banner → sidebar + main content
- **Mobile:** Sticky header → hero banner → content → bottom tab bar (5 tabs) + hamburger drawer for remaining sections

### State Management

No external state library. All state is React `useState` + `useEffect`, lifted to `App.jsx` for cross-cutting concerns (session, profile, the contact-email modal, navigation guards). Props are passed down; no context except `CartContext` (merch shop) and `ToastProvider`.

### Forms

Local state, validate on submit, inline error messages. Common pattern:
```
const [value, setValue] = useState('')
const [saving, setSaving] = useState(false)
const [error, setError] = useState(null)
// on submit: setSaving(true) → supabase call → check error → setSaving(false)
```

## Backend Architecture

There is no custom backend. All server-side logic lives in Supabase:

### Database Access

Every data operation goes `Browser → supabase-js → Supabase REST API → PostgreSQL (with RLS)`. Common patterns:

```javascript
// Read
const { data, error } = await supabase.from('profiles').select('*').eq('id', userId)

// Write
const { error } = await supabase.from('posts').insert({ author_id: userId, content })

// RPC (server-side function)
const { data } = await supabase.rpc('is_approved')

// Edge Function (server-side, needs a secret like RESEND_API_KEY)
const { data, error } = await supabase.functions.invoke('send-contact-email', {
  body: { recipient_id: targetId, subject, message },
})
```

### Server Actions (Edge Functions)

Edge Functions in `supabase/functions/`, deployed via `supabase functions deploy` (this list was last
counted at five and has grown since — treat it as "at least these", not exhaustive; `ls supabase/functions/`
is the source of truth):

1. **`delete-account`** — Self-service: verifies caller's JWT, purges storage, deletes auth user via Admin API
2. **`admin-delete-member`** — Admin: verifies caller is admin via `is_admin()` RPC, then same purge+delete
3. **`send-approval-email`** — Sends "you're verified" email via Resend when admin approves
4. **`send-member-email`** — Admin-to-member email via Resend
5. **`send-contact-email`** — Member-to-member email via Resend, triggered by the "Message" button anywhere in the app (see FEATURES.md § Contact via Email)
6. **`send-directed-email`** — Admin-to-member and member-to-business email via Resend (the mailto: replacements that don't fit send-contact-email's or send-support-email's shape)
7. **`send-broadcast-email`** — Admin -> a selected/filtered group of members, batched through Resend's `/emails/batch` (max 100/call), skipping anyone who's opted out via `notification_preferences.notify_admin_broadcast` (see FEATURES.md § Admin Panel)

All share the same CORS/JSON-response pattern; `delete-account` and `admin-delete-member` additionally share `_shared/accountCleanup.ts` for the `purgeAndDeleteUser()` flow.

### Realtime

Supabase Realtime is enabled on the `posts` table. The Feed subscribes to new posts. (There is no realtime messaging feature anymore — contacting a member sends a single email via `send-contact-email`, with nothing to subscribe to.)

## Data Flow

### Typical Read Flow
```
User opens page
  → Component mounts, useEffect fires
  → supabase.from('table').select(…)
  → Supabase REST API evaluates RLS policies
  → PostgreSQL returns rows matching the policy
  → Component sets state, renders data
```

### Typical Write Flow
```
User fills form, clicks Save
  → Client-side validation (required fields, format checks)
  → supabase.from('table').insert/update(…)
  → Supabase REST API evaluates RLS WITH CHECK
  → PostgreSQL applies constraints + triggers
  → { data, error } returned to component
  → Component shows success toast or error message
```

### Account Deletion Flow
```
User clicks "Delete my account" in Settings
  → supabase.functions.invoke('delete-account')
  → Edge Function: verify JWT → purge all storage buckets → admin.deleteUser()
  → CASCADE deletes profile, posts, jobs, events, etc.
  → Client signs out
```

## Authentication Flow

1. **Signup:** `Auth.jsx` wizard (3 steps: email/password or Google → school details → consent) → Supabase creates auth user → `handle_new_user()` trigger creates profile row → email confirmation sent
2. **Social login catch-up:** Google users land on `FinishSignup.jsx` to provide school details + consent
3. **Admin approval:** Member sits on `PendingVerification.jsx` until an admin approves them in `Admin.jsx`
4. **Session management:** `supabase-js` handles JWT storage, refresh, and `onAuthStateChange` events
5. **Password recovery:** Supabase sends email → user clicks link → `PASSWORD_RECOVERY` event → `ResetPassword.jsx`

## Authorization Flow

Two layers (defense in depth):

1. **React render gates** (App.jsx): unapproved users are locked to FinishSignup/CompleteDetails/PendingVerification screens — they never see the main app routes
2. **RLS policies** (since schema-update-46): every `SELECT` policy requires `is_approved()`, so even if the React gate is bypassed (e.g., direct API call), unapproved users see nothing

Admin actions additionally check `is_admin()` — both client-side (hiding UI) and server-side (RLS policies and Edge Function checks).

Self-elevation is prevented by a `BEFORE UPDATE` trigger on profiles that blocks non-admin users from changing `approved` or `is_admin` columns.

## Deployment Architecture

```
Developer machine
  → git push to GitHub (KTrompy/sacs-hub)
  → Vercel auto-deploys (detects Vite, runs npm run build)
  → Static files served from Vercel CDN
  → vercel.json provides SPA rewrite + security headers

Supabase (separate)
  → Schema changes: paste schema-update-N.sql into SQL Editor
  → Edge Functions: supabase functions deploy <name>
  → Email templates: paste into Auth → Email Templates
  → Storage/Auth config: Supabase Dashboard
```

### Environment Variables

All prefixed `VITE_` (Vite exposes them to the client):
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon/publishable key (safe for frontend)
- `VITE_MAPBOX_TOKEN` — Mapbox public token
- `VITE_SITE_URL` — Canonical site URL for auth redirects (optional for local dev)
- `VITE_TURNSTILE_SITE_KEY` — Cloudflare Turnstile site key (not yet active)

**Never in the frontend:** `SUPABASE_SERVICE_ROLE_KEY` (Edge Function secret only).

## Important Architectural Rules

1. **This is a client-side SPA.** No SSR, no server-side rendering, no middleware. All rendering happens in the browser.
2. **Supabase IS the backend.** RLS policies are the authorization layer. Edge Functions handle what RLS can't (account deletion, sending email).
3. **One CSS file.** All styles live in `src/styles.css` with design tokens at the top. No CSS modules, no Tailwind, no styled-components.
4. **One component per file.** Route-level components are lazy-loaded. Shared UI components are eagerly imported where used.
5. **Sequential SQL migrations.** Database changes are `schema-update-N.sql` files run manually in the SQL Editor. The consolidated `schema-all.sql` is a read-only reference.
6. **Security headers in Vercel.** CSP, HSTS, X-Frame-Options etc. are set in `vercel.json`, not in the app.
