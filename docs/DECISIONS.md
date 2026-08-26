# DECISIONS.md — Architecture Decision Records

> Records the key technical choices made in this project, the reasoning behind them, and their consequences.
> Each decision documents **what** was chosen, **why**, and **what trade-offs** it brings.

---

## ADR-001: Single-Page Application (React SPA) — No SSR

**Decision:** Build as a client-side React SPA served as static files, with no server-side rendering (Next.js, Remix, etc.).

**Context:** The app is a private, login-gated alumni network. Every page requires authentication — there is no public content to index. SEO is irrelevant. The user base is measured in hundreds, not millions.

**Reasoning:**
- No public pages means no SEO benefit from SSR.
- Static SPA can be served from Vercel's CDN with a single catch-all rewrite (`vercel.json`).
- Eliminates server runtime costs and complexity (no Node server, no edge runtime for pages).
- Supabase handles all backend concerns (auth, database, storage, realtime).

**Trade-offs:**
- First meaningful paint requires downloading the JS bundle before anything renders.
- Mitigated by Vite's code splitting and lazy-loaded routes (only Home + Auth are eagerly loaded).

---

## ADR-002: Plain JavaScript — No TypeScript

**Decision:** The entire codebase is vanilla JavaScript (`.js` / `.jsx`). No TypeScript.

**Context:** Solo-developer project where speed of iteration outweighs type safety.

**Reasoning:**
- Eliminates build-time type errors, tsconfig complexity, and `.d.ts` maintenance.
- Faster iteration for a single developer who knows the codebase.
- Supabase JS client works identically in JS and TS.

**Trade-offs:**
- No compile-time type checking — bugs that TypeScript would catch are only found at runtime.
- IDE autocomplete is less precise (though JSDoc + Vite's HMR compensate somewhat).
- If the team grows, TypeScript adoption should be reconsidered.

---

## ADR-003: Single CSS File — No CSS Modules, No Preprocessors

**Decision:** All styles live in one `src/styles.css` file (~11,000 lines). No CSS modules, no Sass/Less, no utility frameworks (Tailwind, etc.).

**Context:** The design system is token-based with CSS custom properties. Class naming is descriptive (`.feature-element` pattern).

**Reasoning:**
- One file means one place to search for any style rule. No import chains to trace.
- CSS custom properties provide the variable/theming layer that Sass variables once required.
- No build step for CSS — Vite serves it directly.
- Consistent with the "zero unnecessary dependencies" philosophy.

**Trade-offs:**
- File is large and can be intimidating to navigate. Section comments (`/* ---------- */`) provide structure.
- No automatic scoping — class name collisions are prevented by convention, not tooling.
- No dead CSS elimination — unused rules accumulate unless manually pruned.

---

## ADR-004: Supabase as Full Backend

**Decision:** Use Supabase (hosted PostgreSQL + Auth + Storage + Realtime + Edge Functions) as the entire backend. No custom API server.

**Context:** The app needs auth, a relational database, file storage, and real-time messaging. Supabase provides all four under one SDK.

**Reasoning:**
- One SDK, one dashboard, one billing relationship.
- Row Level Security (RLS) enforces authorization at the database layer — no middleware to write or maintain.
- Realtime subscriptions for messages and posts with no WebSocket server to manage.
- Edge Functions (Deno) handle the few operations that need server-side logic (account deletion, email sending).
- Auth handles email/password, Google OAuth, email confirmation, and password recovery.

**Trade-offs:**
- Direct client-to-database queries (via PostgREST) mean the schema is part of the API surface. Schema changes can break the frontend.
- Complex business logic in RLS policies is harder to test than middleware code.
- Vendor lock-in to Supabase's hosting and API layer (mitigated by Postgres being standard SQL).

---

## ADR-005: Row Level Security on Every Table

**Decision:** Every table has RLS enabled, and every SELECT policy gates on `is_approved()` (a database function that checks the caller's profile).

**Context:** The app has an approval workflow — new signups must be approved by an admin before seeing any member content.

**Reasoning:**
- Defense in depth: even if a React render gate is bypassed (or the app is accessed via the Supabase API directly), no data leaks.
- `is_approved()` is a single point of enforcement — the function checks `profiles.approved` for the calling user's JWT.
- Schema-update-46 was a dedicated security hardening pass that added this gate to every existing SELECT policy.

**Trade-offs:**
- Every query pays the cost of the `is_approved()` function call (negligible for this user base).
- Policy debugging is harder — a missing or wrong policy silently returns zero rows rather than throwing an error.
- The React layer must still gate UI for good UX (loading states, access-denied screens).

---

## ADR-006: Sequential SQL Migration Files

**Decision:** Database schema changes are managed as sequential SQL files (`schema-update-0.sql` through `schema-update-62.sql`), applied manually in order. No migration framework (Supabase CLI migrations, Prisma, etc.).

**Context:** Solo developer applying changes directly to a hosted Supabase project.

**Reasoning:**
- Each file is a self-contained, auditable record of what changed and why (comments included).
- No migration runner to configure, no migration state table to manage.
- Changes are applied via the Supabase SQL editor — the developer reads the file, understands it, and runs it.

**Trade-offs:**
- No rollback mechanism — reversing a migration requires writing a new one.
- No automated "current schema state" — `schema-all.sql` is the consolidated reference (migrations 0–57), updated periodically.
- Risk of applying migrations out of order on a fresh database (mitigated by sequential numbering).

---

## ADR-007: Client-Side Routing with Lazy Loading

**Decision:** Use react-router-dom v6 for client-side routing. All routes except Home and Auth are lazy-loaded via `React.lazy()`.

**Context:** The app has 20+ routes. Loading everything upfront would mean a large initial bundle.

**Reasoning:**
- Home and Auth are eagerly loaded because every session starts at one of them.
- All other routes (Feed, Jobs, Events, etc.) are lazy — their chunks load on first navigation.
- Vite's manual chunk configuration (`vendor-react`, `vendor-leaflet`, `vendor-supabase`) separates framework code from page code.
- Suspense fallback shows a loading spinner during chunk fetch.

**Trade-offs:**
- First visit to a lazy route has a brief loading flash (chunk download).
- Import chains must be careful: Home.jsx imports from specific modules (`WhosOnline.jsx`, `BusinessLogo.jsx`) rather than from `Feed.jsx` or `BusinessDirectory.jsx` to avoid pulling those full ~40-60KB modules into the eagerly-loaded bundle.

---

## ADR-008: Supabase Edge Functions for Destructive/Privileged Operations

**Decision:** Account deletion and email sending run as Supabase Edge Functions (Deno/TypeScript), not as client-side operations.

**Context:** Deleting an account requires the `service_role` key to cascade through storage and auth. Sending emails requires a server-side API key.

**Reasoning:**
- The `service_role` key must never reach the client. Edge Functions keep it server-side.
- Each function verifies the caller's JWT, checks authorization (self-delete or admin), then uses the service-role client for the actual operation.
- CORS is configured per-function with an `ALLOWED_ORIGINS` list.
- Shared cleanup logic lives in `_shared/accountCleanup.ts`.

**Trade-offs:**
- Edge Functions are Deno/TypeScript, while the frontend is JavaScript — two runtimes to maintain.
- Cold starts add ~200-500ms to the first invocation.
- Testing requires deploying to Supabase (no local Edge Function emulator in this setup).

---

## ADR-009: DOMPurify for HTML Sanitization

**Decision:** All user-generated rich text (posts, job descriptions, business descriptions, event descriptions) is sanitized with DOMPurify before storage and on render.

**Context:** The WYSIWYG editor produces HTML. Storing and rendering raw HTML from users is an XSS vector.

**Reasoning:**
- DOMPurify is a well-maintained, widely-used sanitizer with a strong security track record.
- `sanitizeHtml()` in `src/sanitizeHtml.js` wraps DOMPurify with the app's allowed tag/attribute set.
- HTML is parsed via `DOMParser` into detached documents (not live DOM) when extracting plain text for search — prevents script execution even during text extraction.

**Trade-offs:**
- Runtime dependency (~15KB gzipped).
- Sanitizer configuration must be maintained — new HTML features (e.g., adding video embeds) require updating the allowed list.

---

## ADR-010: Mapbox Tiles + Leaflet — No Google Maps

**Decision:** Maps use Leaflet (via react-leaflet) with Mapbox vector tiles and Mapbox geocoding. No Google Maps SDK.

**Context:** The app has three map views (Alumni Map, Events, Businesses) plus geocoding for profile/event/job/business locations.

**Reasoning:**
- Leaflet is open-source with no per-load billing.
- Mapbox tiles provide good-quality cartography at a lower cost than Google Maps.
- Mapbox geocoding (`geocode.js`) converts city names to lat/lng for map pins.
- `react-leaflet` provides React-native bindings (declarative markers, popups).

**Trade-offs:**
- Mapbox token is exposed on the client (acceptable — it's scoped to tile/geocode requests).
- Leaflet's z-index management conflicts with sticky headers (solved by `isolation: isolate` on `.leaflet-container`).

---

## ADR-011: Self-Elevation Prevention in Database

**Decision:** A PostgreSQL `BEFORE UPDATE` trigger on the `profiles` table prevents any user (including admins) from setting their own `is_admin` flag via the API.

**Context:** Since the client talks directly to the database via PostgREST, a compromised or malicious client could attempt to SET `is_admin = true` on their own profile.

**Reasoning:**
- The trigger runs at the database level — it cannot be bypassed by client-side code.
- Admin promotion must go through a separate, audited process.
- All admin actions are logged to the `admin_actions` table by database triggers (immutable audit trail).

**Trade-offs:**
- Admin promotion requires direct database access or a dedicated Edge Function.
- The trigger's existence must be documented (here) so future developers don't waste time debugging why an admin update "silently fails."

---

## ADR-012: No Testing Framework

**Decision:** The project has no test runner, no test files, and no testing dependencies.

**Context:** Solo developer, rapid iteration, small user base with direct feedback.

**Reasoning:**
- The developer prioritized shipping features over test infrastructure.
- Manual testing via the live app is the current QA process.
- RLS policies provide a layer of "infrastructure testing" — unauthorized access fails at the database level.

**Trade-offs:**
- No automated regression detection — refactoring carries more risk.
- No CI/CD pipeline to catch breakage before deploy.
- If contributors join, a testing strategy should be the first infrastructure investment.

---

## ADR-013: No Linter or Formatter

**Decision:** No ESLint, Prettier, or other code-quality tooling is configured.

**Context:** Consistent style is maintained by one developer's habits, not by tooling.

**Reasoning:**
- Avoids configuration overhead and build-step complexity.
- The codebase is stylistically consistent (same indentation, naming, comment style throughout).

**Trade-offs:**
- No automated style enforcement if contributors join.
- IDE-specific formatting differences could creep in.
- Consider adding ESLint + Prettier if the team grows beyond one person.

---

## ADR-014: Vercel for Hosting

**Decision:** The SPA is deployed to Vercel as a static site with a catch-all rewrite and security headers.

**Context:** The app is a static SPA with no server runtime requirements.

**Reasoning:**
- Vercel's free tier is sufficient for this traffic level.
- The catch-all rewrite (`/(.*) → /index.html`) handles client-side routing.
- Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options) are configured in `vercel.json`.
- Git-push deploys with preview URLs for branches.

**Trade-offs:**
- Vendor lock-in to Vercel's deployment platform (mitigated by the app being static — any CDN/static host works).
- CSP must be maintained in `vercel.json` when adding new external resources.

---

## ADR-015: POPIA-Compliant Privacy Policy

**Decision:** The app includes a built-in POPIA (Protection of Personal Information Act, South Africa) privacy notice, shown during signup and accessible from settings/footer.

**Context:** South African alumni network collecting personal information — POPIA compliance is a legal requirement.

**Reasoning:**
- Section 18 of POPIA requires informing data subjects about what's collected, why, by whom, and how to exercise access/correction/deletion rights.
- The notice is rendered as both a full page (`/privacy`) and a modal (for pre-auth signup flow).
- Last-updated date is maintained manually in the component.

**Trade-offs:**
- Legal content is hardcoded in a React component rather than a CMS — updates require a code deploy.
- The notice should be reviewed by a legal professional periodically.
