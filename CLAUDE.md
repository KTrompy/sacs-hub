# SACS Alumni Hub — Claude Operating Manual

> This file is the permanent instruction set for AI-assisted development on this project.
> Detailed reference lives in `/docs`. This file is concise and actionable.

## Project Overview

SACS Alumni Hub is a private community platform for SACS (South African College Schools) Old Boys. Members sign up, are verified against school records by an admin, and then access a directory, feed, messaging, events, jobs, business directory, mentoring, merch shop, and Notable Old Boys spotlight.

**Live at:** Vercel (currently `*.vercel.app`; intended domain `sacsalumni.org`)
**Admin account:** sacsalumnihub@gmail.com

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | React 18 (SPA, client-side routing) |
| Build | Vite 5 |
| Routing | react-router-dom v6 |
| Styling | Single vanilla CSS file (`src/styles.css`, ~11k lines), CSS custom properties |
| Database | Supabase (PostgreSQL) with RLS |
| Auth | Supabase Auth (email/password + Google OAuth) |
| Storage | Supabase Storage (private + public buckets) |
| Edge Functions | Supabase Edge Functions (Deno/TypeScript) |
| Maps | Leaflet + react-leaflet, Mapbox tiles + geocoding |
| Rich text | DOMPurify, custom toolbar |
| Bot protection | Cloudflare Turnstile (not yet active) |
| Email | Resend (not yet configured) |
| Hosting | Vercel (static SPA with catch-all rewrite) |
| Language | JavaScript (JSX) — no TypeScript |

**No TypeScript, no testing framework, no linter, no state management library.** Validation is runtime only. State is React `useState`/`useEffect` throughout.

## Architecture Summary

```
Single-page React app (Vite)
  ├── src/App.jsx          — routing, auth gates, layout shell
  ├── src/components/      — one file per page/feature (~90 JSX files)
  ├── src/supabaseClient.js — Supabase client + shared helpers
  ├── src/styles.css       — all CSS (design tokens at top)
  ├── src/constants.js     — dropdown lists, industry keywords
  ├── src/utils.js         — shared utilities
  └── public/              — static assets (logos, manifest)

Supabase (backend-as-a-service)
  ├── PostgreSQL           — all data, RLS on every table
  ├── Auth                 — signup, sessions, password reset
  ├── Storage              — avatars, CVs, images (10 buckets)
  ├── Edge Functions       — account deletion, admin emails
  └── Realtime             — live message/post delivery
```

**No server-side rendering. No API routes. No middleware.** Every data operation goes directly from the browser to Supabase via the JS client.

## Critical Rules

### General

1. **Inspect before modifying.** Read the relevant files, trace the data flow, understand what exists.
2. **Search for existing implementations** before creating new ones. The codebase already has patterns for almost everything.
3. **Reuse existing components.** Check `src/components/` — `ConfirmDialog`, `EmptyState`, `LoadingState`, `Toast`, `ClearableInput`, `PhotoCropper`, `RichTextEditor`, autocomplete pickers, etc. already exist.
4. **Do not duplicate functionality.** If something works, use it.
5. **Make the smallest correct change.** Every line changed is a line that can break.
6. **Do not modify unrelated files.** A bug fix for Events should not touch Feed.
7. **Do not introduce dependencies** unless genuinely necessary. The project runs on 7 runtime deps.
8. **Preserve existing architecture.** This is a Vite SPA talking directly to Supabase. Do not introduce a backend, SSR, or a state management library.
9. **Do not rewrite working code** to match a different style or pattern.
10. **No TypeScript migration.** The project is JavaScript. Keep it that way unless Kyle explicitly decides otherwise.

### Supabase / Database

1. **Inspect the schema before modifying it.** Read `schema-all.sql` and the latest `schema-update-*.sql` files.
2. **Inspect RLS policies** before changing database access patterns. Every table has RLS enabled.
3. **Never disable RLS** as a shortcut — not even temporarily.
4. **Never expose the service-role key** in client-side code. It belongs only in Edge Functions.
5. **Do not put secrets in `.env`** beyond the anon key and public tokens. Service-role key lives in Supabase Secrets.
6. **Use sequential migration files** (`schema-update-N.sql`). The project does not use the Supabase CLI migration system for schema changes — it uses numbered SQL files run in the SQL Editor.
7. **Preserve existing data.** Never DROP a column or table with live data without explicit approval.
8. **Consider authorization for every database operation.** Who can read this? Who can write it? What about the owner vs. other members vs. admins?
9. **Test both authorized and unauthorized behavior.** RLS policies must block what they claim to block.
10. **`is_approved()` gates everything.** Unapproved accounts must not see other members' data.

### Authentication

- Auth is Supabase Auth (email/password + Google OAuth).
- Sessions are managed by `supabase-js` (JWT in memory, refresh via `supabase.auth.getSession()`).
- The signup flow is: `Auth.jsx` → email confirmation → `FinishSignup.jsx` (social logins) → `CompleteDetails.jsx` (legacy) → admin approval → full app access.
- `App.jsx` enforces the approval gate in render order: declined → consent → details → pending → approved.
- Protected routes are enforced by **both** the React render gates **and** RLS policies (defense in depth since schema-update-46).

### UI / Design

1. **Reuse existing components** — check what exists before building anything new.
2. **Preserve the existing design language.** SACS navy (`#002F5F`) + baby blue (`#6EC3E8`) + cream (`#FAF7F2`). Georgia for headings, Inter/system sans for body.
3. **All CSS goes in `src/styles.css`.** Use the existing design tokens (`--maroon`, `--orange`, `--sp-*`, `--fs-*`, `--radius-*`). No CSS modules, no CSS-in-JS.
4. **Handle loading states** (`<LoadingState />`), **error states**, and **empty states** (`<EmptyState />`).
5. **Maintain responsive behavior.** Desktop sidebar + mobile bottom tab bar. Breakpoint at ~720–900px.
6. **Consider accessibility.** Use semantic HTML, `aria-label` where needed, keyboard navigation.

### Code Conventions

- **One component per file** in `src/components/`.
- **Eager imports** for auth/layout components; **`React.lazy()`** for route-level pages.
- **`supabase.from('table').select/insert/update/delete`** for all DB access — no raw SQL from the client.
- **Error handling:** check `{ data, error }` from every Supabase call. Use `isAuthError()` / `isNetworkError()` from `supabaseClient.js`.
- **Forms:** local `useState`, validate on submit, show inline errors, disable button while saving.
- **Navigation:** use `goTo()` (from App.jsx's `attemptNavigate`) or `useNavigate()`. Never `window.location`.
- **Storage URLs:** use `storagePathFromUrl()` and `openStorageFile()` from `supabaseClient.js`, not raw URL construction.
- **Notifications:** insert into the `notifications` table (the bell reads from it).

## Task Workflow

For every task, follow this order:

### 1. INVESTIGATE
- Read the relevant files
- Search for existing implementations (`grep` the codebase)
- Trace the data flow (component → Supabase → table → RLS)
- Understand what already exists

### 2. PLAN
- Identify files to change
- Identify dependencies and side effects
- Identify database changes needed
- Identify security implications
- For non-trivial changes, state the plan before coding

### 3. IMPLEMENT
- Make the smallest correct change
- Follow existing patterns
- Reuse existing components and utilities

### 4. VERIFY
- Run: `npm run build` (the only available check — no linter/tests)
- Test mentally: desktop + mobile, loading/error/empty states, auth + unauth
- Check authorization: who can see/do this? What if they're unapproved?

### 5. REVIEW
- Review the final diff
- Check for accidental changes, duplicated code, security issues
- Confirm no regressions

## Communication Rules

At the end of every task, report:
- **What changed** (files modified/created)
- **Checks run** (build result)
- **Failures encountered**
- **Remaining concerns**
- **Anything requiring manual verification**

## Key File Reference

| File | Purpose |
|---|---|
| `src/App.jsx` | Root component: routing, auth gates, layout |
| `src/supabaseClient.js` | Supabase client, auth helpers, storage helpers |
| `src/styles.css` | All CSS + design tokens |
| `src/constants.js` | Industries, titles, provinces, badge definitions |
| `src/utils.js` | Shared utilities (ranking, formatting, validation) |
| `schema-all.sql` | Consolidated database schema (read-only reference) |
| `schema-update-*.sql` | Individual migrations (apply in SQL Editor) |
| `vercel.json` | Vercel config (SPA rewrite + security headers) |
| `.env.example` | Environment variable template |
| `supabase/functions/` | Edge Functions (Deno/TypeScript) |

## Documentation

Detailed documentation lives in `/docs`:
- `ARCHITECTURE.md` — full architecture, data flows, deployment
- `DATABASE.md` — tables, RLS, storage, functions, migration guide
- `FEATURES.md` — feature inventory with status and file locations
- `DESIGN.md` — visual system, tokens, component catalog
- `DECISIONS.md` — architecture decision records
- `SECURITY.md` — security checklist and findings
- `DEVELOPMENT_WORKFLOW.md` — step-by-step processes for common tasks
