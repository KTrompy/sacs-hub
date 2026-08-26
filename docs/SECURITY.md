# SECURITY.md — Security Checklist & Reference

> Documents every security layer in the SACS Alumni Hub.
> Read this before touching auth, RLS, storage, or API-facing code.

---

## 1. Authentication

### Providers
- **Email/password** — signup with email confirmation, password strength validation (`src/passwordRules.jsx`: minimum length, strength meter)
- **Google OAuth** — via Supabase Auth, lands in FinishSignup.jsx for consent + detail capture

### Session Management
- Supabase Auth handles JWTs, refresh tokens, and session persistence
- `supabase.auth.getSession()` is called before privileged operations to ensure a fresh token
- `isAuthError()` and `isNetworkError()` in `supabaseClient.js` distinguish auth failures from connectivity issues

### Approval Workflow
- New accounts require admin approval before accessing member content
- Flow: signup → email confirm → consent → details → **pending approval** → approved
- Declined accounts see a "declined" screen; deleted accounts see a "deleted" screen
- The App.jsx render chain enforces this in strict order — no route renders until all gates pass

### Bot Protection
- Cloudflare Turnstile is integrated (`src/components/Turnstile.jsx`) but **not yet active** — `VITE_TURNSTILE_SITE_KEY` is unset
- When configured, Turnstile will gate signup, login, and account deletion

---

## 2. Authorization — Row Level Security (RLS)

### Principle
Every table has RLS enabled. There are no tables with RLS disabled.

### Key Database Functions

| Function | Purpose |
|----------|---------|
| `is_approved()` | Returns true if the calling user's profile has `approved = true`. Gates every `SELECT` policy on member-visible tables. |
| `is_admin()` | Returns true if the calling user has `is_admin = true`. Gates admin-only policies. |

### Policy Pattern

```sql
-- Standard member read policy
CREATE POLICY "members read" ON some_table
  FOR SELECT USING (public.is_approved());

-- Standard member write policy (own rows only)
CREATE POLICY "members write own" ON some_table
  FOR INSERT WITH CHECK (user_id = auth.uid() AND public.is_approved());

-- Admin-only policy
CREATE POLICY "admins manage" ON some_table
  FOR ALL USING (public.is_admin());
```

### Defense in Depth
Authorization is enforced at **two layers**:
1. **Database (RLS)** — even direct API/PostgREST access is gated
2. **React render gates** — App.jsx checks session, approval status, and admin flag before rendering routes

Both must agree. Never rely on only one.

### Schema-Update-46: The Security Hardening Pass
Migration 46 was a dedicated security review that:
- Added `is_approved()` gate to every SELECT policy that was missing it
- Ensured unapproved users see zero rows from any member-visible table
- This migration is the security baseline — any new table must follow the same pattern

---

## 3. Admin Security

### Self-Elevation Prevention
- A `BEFORE UPDATE` trigger (`prevent_last_admin_demotion`) on the `profiles` table prevents:
  - Demoting the last remaining admin (raises an exception)
- Admin promotion requires direct database access — it cannot be done through the client API by design
- The `admin-delete-member` Edge Function refuses to let an admin delete their own account if they are the sole admin

### Admin Audit Trail
- The `admin_actions` table is an **immutable audit log**
- Written by database triggers (not application code) — cannot be bypassed
- `INSERT`, `UPDATE`, `DELETE` permissions are revoked from `authenticated` and `anon` roles
- Only the `log_admin_action()` function (SECURITY DEFINER) can write to it
- `log_admin_action()` is revoked from `public`, `anon`, and `authenticated` — only callable from within other trigger functions, preventing forged entries
- Logged actions: approve, decline, un-approve, delete member, delete post/job/event/business, report review/dismiss

### Admin-Only RLS
Admin operations use `is_admin()` in their RLS policies. Member-level access never includes admin capabilities.

---

## 4. Edge Function Security

### Pattern (all functions follow this)
1. **CORS check** — `ALLOWED_ORIGINS` list, preflight handled
2. **JWT verification** — `Authorization` header extracted, verified via Supabase Auth
3. **Authorization check** — function verifies the caller is allowed (e.g., self-delete checks `user.id === target`, admin-delete checks `is_admin`)
4. **Service role execution** — destructive operations use the `SUPABASE_SERVICE_ROLE_KEY` (server-side only, never exposed to client)

### Functions

| Function | Auth Check | What It Does |
|----------|-----------|--------------|
| `delete-account` | Caller must be deleting themselves | Cascades through storage buckets, then deletes auth user |
| `admin-delete-member` | Caller must be admin, target must not be caller | Same cascade, logged to admin_actions |
| `send-approval-email` | Caller must be admin | Sends approval notification via Resend (not yet configured) |
| `send-member-email` | Caller must be admin | Sends arbitrary email to member via Resend |

### Shared Cleanup (`_shared/accountCleanup.ts`)
Handles storage teardown across all buckets when an account is deleted. Uses the service-role client.

---

## 5. Secrets Management

### Environment Variables

| Variable | Where Used | Exposure |
|----------|-----------|----------|
| `VITE_SUPABASE_URL` | Client | Public (by design — Supabase project URL) |
| `VITE_SUPABASE_ANON_KEY` | Client | Public (by design — anon key, gated by RLS) |
| `VITE_MAPBOX_TOKEN` | Client | Public (scoped to tile/geocode requests) |
| `VITE_SITE_URL` | Client | Public (the app's own URL) |
| `VITE_TURNSTILE_SITE_KEY` | Client | Public (Cloudflare site key, not the secret) |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only | **SECRET — never expose to client** |
| `RESEND_API_KEY` | Edge Functions only | **SECRET — never expose to client** |

### Rules
- **Never commit `.env` files** — `.env.example` documents the shape without values
- **Never log or print secrets** — not even in error messages
- `VITE_` prefixed variables are bundled into the client by Vite — anything without that prefix stays server-side
- The `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS — it must only exist in Edge Function environment variables

---

## 6. Content Security Policy (CSP)

Configured in `vercel.json`:

```
default-src 'self';
script-src 'self' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob: https://*.supabase.co https://api.mapbox.com https://*.tile.openstreetmap.org;
media-src 'self' blob: https://*.supabase.co;
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mapbox.com https://ipapi.co https://ipwho.is https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com;
object-src 'none';
base-uri 'self';
form-action 'self'
```

### Other Security Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `DENY` | Prevents clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer leakage |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | Disables unused browser APIs |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Forces HTTPS (2-year max-age) |

---

## 7. Storage Security

### Bucket Policies

| Bucket | Access | RLS Pattern |
|--------|--------|-------------|
| `avatars` | **Private** | Owner read/write, members read via `is_approved()` |
| `cvs` | **Private** | Owner-only read/write |
| `post-images` | Public | Members write own via `is_approved()` |
| `post-videos` | N/A | Bucket does not exist yet (video uploads disabled) |
| `business-logos` | Public | Members write own via `is_approved()` |
| `business-covers` | Public | Members write own via `is_approved()` |
| `event-images` | Public | Members write own via `is_approved()` |
| `job-logos` | Public | Members write own via `is_approved()` |
| `job-attachments` | Public | Members write own via `is_approved()` |
| `job-application-files` | **Private** | Applicant write, job poster read via signed URLs (60s expiry) |
| `album-photos` | Public | Members write own via `is_approved()` |
| `merch-images` | Public | Admin write via `is_admin()` |

### Private File Access
Private files are accessed via short-lived signed URLs (`createSignedUrl(path, 60)` — 60 seconds). Never expose raw storage paths to unauthorized users.

---

## 8. Input Sanitization

### HTML Content
- All user-generated rich text is sanitized with **DOMPurify** (`src/sanitizeHtml.js`)
- Two sanitizer configurations: `sanitizeHtml()` (posts, jobs, events) and `sanitizeBusinessHtml()` (business descriptions, extended tag set)
- Sanitization happens both on save and on render (belt and braces)

### Text Extraction
- Plain text extraction from HTML (for search matching) uses `DOMParser` to create a **detached document** — never `innerHTML` on a live element
- This prevents script execution even when processing untrusted HTML for search/preview

### URL Validation
- `isSafeHttpUrl()` in `utils.js` validates URLs before rendering them as links
- `safeUrl()` wraps URLs with protocol normalization
- Prevents `javascript:` and other dangerous URL schemes

---

## 9. Client-Side Security

### No Sensitive Data in Local State
- JWTs are managed by Supabase Auth (stored in `localStorage` by the Supabase client)
- No application secrets, service keys, or sensitive tokens are stored in component state or `localStorage`
- Cart state is in-memory React context (lost on refresh — by design, no sensitive data persists)

### Discard Guards
- `useDiscardGuard` hook prevents accidental navigation when forms have unsaved changes
- Used in Feed, Jobs, Businesses, and Profile editors

### Error Boundaries
- `ErrorBoundary.jsx` wraps the entire app to catch unhandled React errors
- Errors are displayed to the user; they do not leak stack traces or internal state

---

## 10. Database Function Security

### EXECUTE Revocations
Schema-update-47 and 49 systematically revoked `EXECUTE` on sensitive functions from `public`, `anon`, and `authenticated`:

- `log_admin_action()` — only callable from triggers
- `prevent_last_admin_demotion()` — only callable from triggers
- `is_admin()` — kept callable (needed by RLS policies, which run in the user's context)
- `is_approved()` — kept callable (same reason)

### Security Definer Functions
Functions that need elevated access use `SECURITY DEFINER` with `SET search_path TO 'public'` to prevent search-path hijacking.

---

## 11. Security Checklist for New Features

Before shipping any new feature, verify:

- [ ] **RLS policies exist** on every new table — both `SELECT` (gated on `is_approved()`) and write policies (gated on `auth.uid()` ownership + `is_approved()`)
- [ ] **Admin-only tables/operations** use `is_admin()` in their policies
- [ ] **Storage buckets** have appropriate policies (private for sensitive files, public + ownership for user content)
- [ ] **Edge Functions** verify JWT, check authorization, and never expose the service-role key
- [ ] **User input** is sanitized — HTML through DOMPurify, URLs through `isSafeHttpUrl()`, file types/sizes validated client-side
- [ ] **CSP** is updated in `vercel.json` if new external resources are added
- [ ] **No secrets** in client-side code — only `VITE_`-prefixed env vars reach the bundle
- [ ] **React render gates** match the RLS policies — don't show UI for data the user can't access
- [ ] **Sensitive operations** are logged to `admin_actions` via database triggers
- [ ] **Private files** are accessed via signed URLs with short expiry, never direct paths

---

## 12. Known Gaps & Recommendations

1. **Turnstile not active** — configure `VITE_TURNSTILE_SITE_KEY` and the Cloudflare secret to enable bot protection on auth flows
2. **Resend not configured** — approval/member emails will fail silently until the Resend API key is set
3. **No rate limiting** — Supabase's built-in rate limiting applies, but no application-level throttling exists for sensitive endpoints
4. **No CSRF tokens** — mitigated by CSP and the SPA architecture (no server-rendered forms), but consider adding if server-side form handling is ever introduced
5. **Video upload bucket missing** — `post-videos` bucket referenced in code does not exist. Feature is correctly disabled (`VIDEO_UPLOADS_ENABLED = false`), but the bucket and its policies should be created before enabling
6. **No automated security scanning** — no dependency audit (`npm audit`), no SAST, no penetration testing. Consider adding `npm audit` to a CI pipeline
